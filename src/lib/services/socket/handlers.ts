import { Server, Socket } from 'socket.io';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import Message from '@/lib/db/models/Message';
import Chat from '@/lib/db/models/Chat';
import Call from '@/lib/db/models/Call';
import Group from '@/lib/db/models/Group';
import Status from '@/lib/db/models/Status';
import Contact from '@/lib/db/models/Contact';
import { SOCKET_EVENTS, DEFAULTS, TIME_CONSTANTS } from '@/lib/utils/constants';
import { analyticsTracker } from '../analytics/tracker';
import { apnsService } from '../push-notifications/apns';
import { fcmService } from '../push-notifications/fcm';
import { ValidationHelpers, DateHelpers } from '@/lib/utils/helpers';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  InterServerEvents, 
  SocketData 
} from '@/types/socket';
import type { AuthenticatedSocket } from './events';

export class SocketHandlersService {
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private onlineUsers = new Map<string, { lastSeen: Date; socketIds: Set<string> }>();
  private userTypingStatus = new Map<string, Map<string, NodeJS.Timeout>>(); // userId -> chatId -> timeout

  constructor(io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {
    this.io = io;
    this.startHeartbeat();
  }

  // Message handlers
  async handleNewMessage(
    senderId: string,
    chatId: string,
    messageData: any,
    socket?: AuthenticatedSocket
  ): Promise<void> {
    try {
      await connectDB();

      // Validate chat and permissions
      const chat = await Chat.findById(chatId)
        .populate('participants', 'displayName avatar isOnline')
        .populate('groupInfo.admins')
        .lean();

      if (!chat) {
        socket?.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Chat not found' });
        return;
      }

      // Check if user is participant
      if (!chat.participants.some((p: any) => p._id.toString() === senderId)) {
        socket?.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Not a chat participant' });
        return;
      }

      // Check group permissions
      if (chat.type === 'group' && chat.groupInfo?.settings?.onlyAdminsCanMessage) {
        const isAdmin = chat.groupInfo.admins.some((admin: any) => admin._id.toString() === senderId);
        if (!isAdmin) {
          socket?.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Only admins can send messages' });
          return;
        }
      }

      // Create and save message
      const message = new Message({
        chatId,
        senderId,
        type: messageData.type,
        content: messageData.content,
        mediaId: messageData.mediaId,
        location: messageData.location,
        contact: messageData.contact,
        replyTo: messageData.replyTo,
        mentions: messageData.mentions || [],
        isForwarded: messageData.isForwarded || false,
        forwardedFrom: messageData.forwardedFrom
      });

      await message.save();

      // Update chat last message
      await Chat.findByIdAndUpdate(chatId, {
        lastMessage: message._id,
        lastMessageTime: new Date(),
        $inc: { 'unreadCount.$[elem].count': 1 }
      }, {
        arrayFilters: [{ 'elem.userId': { $ne: senderId } }]
      });

      // Populate message for response
      const populatedMessage = await Message.findById(message._id)
        .populate('senderId', 'displayName avatar username')
        .populate('replyTo')
        .populate('mediaId')
        .lean();

      // Emit to all chat participants
      chat.participants.forEach((participant: any) => {
        this.io.to(`user:${participant._id}`).emit(SOCKET_EVENTS.MESSAGE_NEW, {
          message: populatedMessage,
          sender: populatedMessage.senderId
        });
      });

      // Send push notifications to offline users
      await this.sendMessageNotifications(chat, populatedMessage, senderId);

      // Handle mentions
      if (messageData.mentions?.length > 0) {
        await this.handleMentions(messageData.mentions, message, chat);
      }

      // Track analytics
      await analyticsTracker.trackMessage(
        senderId,
        chatId,
        messageData.type,
        {
          isGroup: chat.type === 'group',
          hasMedia: !!messageData.mediaId,
          mentionCount: messageData.mentions?.length || 0
        }
      );

    } catch (error) {
      console.error('Error handling new message:', error);
      socket?.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Failed to send message' });
    }
  }

  // Message delivery and read receipts
  async handleMessageDelivery(messageId: string, userId: string): Promise<void> {
    try {
      await connectDB();

      const message = await Message.findById(messageId);
      if (!message) return;

      // Add delivery receipt
      const existingDelivery = message.deliveredTo.find(d => d.userId.toString() === userId);
      if (!existingDelivery) {
        message.deliveredTo.push({
          userId,
          deliveredAt: new Date()
        });

        message.status = 'delivered';
        await message.save();

        // Notify sender
        this.io.to(`user:${message.senderId}`).emit(SOCKET_EVENTS.MESSAGE_DELIVERED, {
          messageId,
          userId,
          deliveredAt: new Date()
        });
      }

    } catch (error) {
      console.error('Error handling message delivery:', error);
    }
  }

  async handleMessageRead(messageId: string, userId: string, chatId: string): Promise<void> {
    try {
      await connectDB();

      const message = await Message.findById(messageId);
      if (!message) return;

      // Add read receipt
      const existingRead = message.readBy.find(r => r.userId.toString() === userId);
      if (!existingRead) {
        message.readBy.push({
          userId,
          readAt: new Date()
        });

        message.status = 'read';
        await message.save();

        // Update chat unread count
        await Chat.findByIdAndUpdate(chatId, {
          $inc: { 'unreadCount.$[elem].count': -1 }
        }, {
          arrayFilters: [{ 'elem.userId': userId }]
        });

        // Notify sender
        this.io.to(`user:${message.senderId}`).emit(SOCKET_EVENTS.MESSAGE_READ, {
          messageId,
          userId,
          readAt: new Date()
        });
      }

    } catch (error) {
      console.error('Error handling message read:', error);
    }
  }

  // User presence handlers
  async handleUserOnline(userId: string, socketId: string): Promise<void> {
    try {
      // Update online users map
      if (!this.onlineUsers.has(userId)) {
        this.onlineUsers.set(userId, {
          lastSeen: new Date(),
          socketIds: new Set()
        });
      }
      
      const userStatus = this.onlineUsers.get(userId)!;
      userStatus.socketIds.add(socketId);
      userStatus.lastSeen = new Date();

      // Update database
      await connectDB();
      await User.findByIdAndUpdate(userId, {
        isOnline: true,
        lastSeen: new Date()
      });

      // Notify contacts
      await this.broadcastUserPresence(userId, true);

      // Track analytics
      await analyticsTracker.trackUserActivity(userId, 'online');

    } catch (error) {
      console.error('Error handling user online:', error);
    }
  }

  async handleUserOffline(userId: string, socketId: string): Promise<void> {
    try {
      const userStatus = this.onlineUsers.get(userId);
      if (userStatus) {
        userStatus.socketIds.delete(socketId);

        // If no more socket connections, mark as offline
        if (userStatus.socketIds.size === 0) {
          this.onlineUsers.delete(userId);

          // Update database
          await connectDB();
          await User.findByIdAndUpdate(userId, {
            isOnline: false,
            lastSeen: new Date()
          });

          // Notify contacts
          await this.broadcastUserPresence(userId, false);

          // Track analytics
          await analyticsTracker.trackUserActivity(userId, 'offline');
        }
      }

    } catch (error) {
      console.error('Error handling user offline:', error);
    }
  }

  // Typing indicators
  async handleTypingStart(userId: string, chatId: string): Promise<void> {
    try {
      // Clear existing timeout
      this.clearTypingTimeout(userId, chatId);

      // Broadcast typing status
      this.io.to(`chat:${chatId}`).emit(SOCKET_EVENTS.CHAT_TYPING, {
        chatId,
        userId,
        isTyping: true
      });

      // Set auto-clear timeout
      const timeout = setTimeout(() => {
        this.handleTypingStop(userId, chatId);
      }, DEFAULTS.TYPING_TIMEOUT);

      // Store timeout
      if (!this.userTypingStatus.has(userId)) {
        this.userTypingStatus.set(userId, new Map());
      }
      this.userTypingStatus.get(userId)!.set(chatId, timeout);

    } catch (error) {
      console.error('Error handling typing start:', error);
    }
  }

  async handleTypingStop(userId: string, chatId: string): Promise<void> {
    try {
      // Clear timeout
      this.clearTypingTimeout(userId, chatId);

      // Broadcast stop typing
      this.io.to(`chat:${chatId}`).emit(SOCKET_EVENTS.CHAT_TYPING, {
        chatId,
        userId,
        isTyping: false
      });

    } catch (error) {
      console.error('Error handling typing stop:', error);
    }
  }

  // Call handlers
  async handleCallIncoming(call: any): Promise<void> {
    try {
      // Notify all participants
      call.participants.forEach((participant: any) => {
        this.io.to(`user:${participant.userId}`).emit(SOCKET_EVENTS.CALL_INCOMING, { call });
      });

      // Send push notifications
      await this.sendCallNotifications(call);

    } catch (error) {
      console.error('Error handling incoming call:', error);
    }
  }

  async handleCallStatusUpdate(callId: string, status: string, userId?: string): Promise<void> {
    try {
      await connectDB();

      const call = await Call.findById(callId).populate('participants.userId').lean();
      if (!call) return;

      // Broadcast to all participants
      call.participants.forEach((participant: any) => {
        this.io.to(`user:${participant.userId._id}`).emit(SOCKET_EVENTS.CALL_STATUS_UPDATE, {
          callId,
          status,
          userId
        });
      });

    } catch (error) {
      console.error('Error handling call status update:', error);
    }
  }

  // Group handlers
  async handleGroupMemberAdded(groupId: string, addedMembers: string[], addedBy: string): Promise<void> {
    try {
      await connectDB();

      const group = await Group.findById(groupId).populate('members.userId').lean();
      if (!group) return;

      // Notify all current members
      group.members.forEach((member: any) => {
        this.io.to(`user:${member.userId._id}`).emit(SOCKET_EVENTS.CHAT_MEMBER_ADDED, {
          chatId: group.chatId,
          members: addedMembers,
          addedBy
        });
      });

      // Send welcome notifications to new members
      await this.sendGroupJoinNotifications(group, addedMembers, addedBy);

    } catch (error) {
      console.error('Error handling group member added:', error);
    }
  }

  async handleGroupMemberRemoved(groupId: string, removedMembers: string[], removedBy: string): Promise<void> {
    try {
      await connectDB();

      const group = await Group.findById(groupId).populate('members.userId').lean();
      if (!group) return;

      // Notify remaining members
      group.members.forEach((member: any) => {
        if (!removedMembers.includes(member.userId._id.toString())) {
          this.io.to(`user:${member.userId._id}`).emit(SOCKET_EVENTS.CHAT_MEMBER_REMOVED, {
            chatId: group.chatId,
            members: removedMembers,
            removedBy
          });
        }
      });

    } catch (error) {
      console.error('Error handling group member removed:', error);
    }
  }

  // Status handlers
  async handleNewStatus(status: any): Promise<void> {
    try {
      await connectDB();

      // Get user's contacts who can view this status
      const user = await User.findById(status.userId).populate('contacts').lean();
      if (!user) return;

      let viewableBy: string[] = [];

      switch (status.privacy.type) {
        case 'everyone':
          viewableBy = user.contacts.map((c: any) => c._id.toString());
          break;
        case 'contacts':
          viewableBy = user.contacts.map((c: any) => c._id.toString());
          break;
        case 'contacts_except':
          viewableBy = user.contacts
            .filter((c: any) => !status.privacy.excludedContacts?.includes(c._id.toString()))
            .map((c: any) => c._id.toString());
          break;
        case 'only_share_with':
          viewableBy = status.privacy.selectedContacts || [];
          break;
      }

      // Notify users who can view this status
      viewableBy.forEach(userId => {
        this.io.to(`user:${userId}`).emit(SOCKET_EVENTS.STATUS_NEW, { status });
      });

    } catch (error) {
      console.error('Error handling new status:', error);
    }
  }

  // Notification handlers
  async handleSystemNotification(notification: any): Promise<void> {
    try {
      // Send to specific user or broadcast
      if (notification.userId) {
        this.io.to(`user:${notification.userId}`).emit(SOCKET_EVENTS.NOTIFICATION_NEW, { notification });
      } else {
        this.io.emit(SOCKET_EVENTS.NOTIFICATION_NEW, { notification });
      }

    } catch (error) {
      console.error('Error handling system notification:', error);
    }
  }

  // Admin handlers
  async handleAdminBroadcast(message: string, type: 'info' | 'warning' | 'maintenance' = 'info'): Promise<void> {
    try {
      this.io.emit(SOCKET_EVENTS.SYSTEM_MAINTENANCE, {
        message,
        type,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('Error handling admin broadcast:', error);
    }
  }

  // Private helper methods
  private async broadcastUserPresence(userId: string, isOnline: boolean): Promise<void> {
    try {
      await connectDB();

      // Get user's contacts
      const contacts = await Contact.find({ contactUserId: userId }).lean();
      
      // Notify each contact
      contacts.forEach(contact => {
        this.io.to(`user:${contact.userId}`).emit(SOCKET_EVENTS.USER_ONLINE, {
          userId,
          isOnline,
          lastSeen: new Date()
        });
      });

    } catch (error) {
      console.error('Error broadcasting user presence:', error);
    }
  }

  private async sendMessageNotifications(chat: any, message: any, senderId: string): Promise<void> {
    try {
      const sender = await User.findById(senderId).lean();
      if (!sender) return;

      // Get offline participants
      const offlineParticipants = chat.participants.filter((p: any) => 
        p._id.toString() !== senderId && !this.isUserOnline(p._id.toString())
      );

      // Send notifications to offline users
      for (const participant of offlineParticipants) {
        // Check notification settings
        if (!participant.notificationSettings?.messageNotifications) continue;

        const isGroup = chat.type === 'group';
        const title = isGroup ? `${sender.displayName} in ${chat.groupInfo?.name}` : sender.displayName;
        const body = this.formatMessageContent(message);

        // Send push notifications
        await Promise.all([
          apnsService.sendMessageNotification(
            participant._id.toString(),
            chat._id.toString(),
            sender.displayName,
            body,
            isGroup
          ),
          fcmService.sendMessageNotification(
            participant._id.toString(),
            chat._id.toString(),
            sender.displayName,
            body,
            isGroup
          )
        ]);
      }

    } catch (error) {
      console.error('Error sending message notifications:', error);
    }
  }

  private async sendCallNotifications(call: any): Promise<void> {
    try {
      const caller = await User.findById(call.callerId).lean();
      if (!caller) return;

      // Send to all participants except caller
      for (const participant of call.participants) {
        if (participant.userId.toString() === call.callerId.toString()) continue;

        const user = await User.findById(participant.userId).lean();
        if (!user?.notificationSettings?.callNotifications) continue;

        const isGroup = call.callType === 'group';

        // Send push notifications
        await Promise.all([
          apnsService.sendCallNotification(
            participant.userId.toString(),
            call._id.toString(),
            caller.displayName,
            call.type,
            isGroup
          ),
          fcmService.sendCallNotification(
            participant.userId.toString(),
            call._id.toString(),
            caller.displayName,
            call.type,
            isGroup
          )
        ]);
      }

    } catch (error) {
      console.error('Error sending call notifications:', error);
    }
  }

  private async sendGroupJoinNotifications(group: any, newMembers: string[], addedBy: string): Promise<void> {
    try {
      const adder = await User.findById(addedBy).lean();
      if (!adder) return;

      for (const memberId of newMembers) {
        const member = await User.findById(memberId).lean();
        if (!member?.notificationSettings?.groupNotifications) continue;

        const title = `Added to ${group.name}`;
        const body = `${adder.displayName} added you to ${group.name}`;

        // Send push notifications
        await Promise.all([
          apnsService.sendNotificationEmail(member.email, title, body),
          fcmService.sendNotificationEmail(member.email, title, body)
        ]);
      }

    } catch (error) {
      console.error('Error sending group join notifications:', error);
    }
  }

  private async handleMentions(mentions: string[], message: any, chat: any): Promise<void> {
    try {
      const sender = await User.findById(message.senderId).lean();
      if (!sender) return;

      for (const mentionedUserId of mentions) {
        const mentionedUser = await User.findById(mentionedUserId).lean();
        if (!mentionedUser?.notificationSettings?.messageNotifications) continue;

        const title = `${sender.displayName} mentioned you`;
        const body = this.formatMessageContent(message);

        // Send special mention notification
        this.io.to(`user:${mentionedUserId}`).emit(SOCKET_EVENTS.MESSAGE_MENTION, {
          message,
          mentionedBy: sender,
          chat
        });

        // Send push notifications
        await Promise.all([
          apnsService.sendNotificationEmail(mentionedUser.email, title, body),
          fcmService.sendNotificationEmail(mentionedUser.email, title, body)
        ]);
      }

    } catch (error) {
      console.error('Error handling mentions:', error);
    }
  }

  private clearTypingTimeout(userId: string, chatId: string): void {
    const userTimeouts = this.userTypingStatus.get(userId);
    if (userTimeouts) {
      const timeout = userTimeouts.get(chatId);
      if (timeout) {
        clearTimeout(timeout);
        userTimeouts.delete(chatId);
      }
    }
  }

  private formatMessageContent(message: any): string {
    switch (message.type) {
      case 'text':
        return message.content;
      case 'image':
        return '📷 Photo';
      case 'video':
        return '🎥 Video';
      case 'audio':
        return '🎵 Audio';
      case 'voice':
        return '🎤 Voice message';
      case 'document':
        return '📄 Document';
      case 'location':
        return '📍 Location';
      case 'contact':
        return '👤 Contact';
      default:
        return 'Message';
    }
  }

  private isUserOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }

  private startHeartbeat(): void {
    // Clean up inactive users every 30 seconds
    setInterval(() => {
      const now = new Date();
      const timeout = DEFAULTS.ONLINE_TIMEOUT;

      this.onlineUsers.forEach((status, userId) => {
        if (now.getTime() - status.lastSeen.getTime() > timeout) {
          this.handleUserOffline(userId, 'timeout');
        }
      });
    }, 30000);
  }

  // Public getters
  getOnlineUsersCount(): number {
    return this.onlineUsers.size;
  }

  getOnlineUsers(): string[] {
    return Array.from(this.onlineUsers.keys());
  }

  getUserLastSeen(userId: string): Date | null {
    return this.onlineUsers.get(userId)?.lastSeen || null;
  }
}