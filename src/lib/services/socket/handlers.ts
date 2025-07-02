import { Server, Socket } from 'socket.io';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import Message, { IMessage as IMessageDoc } from '@/lib/db/models/Message';
import Chat, { IChat as IChatDoc } from '@/lib/db/models/Chat';
import Call from '@/lib/db/models/Call';
import Group, { IGroup as IGroupDoc } from '@/lib/db/models/Group';
import Status from '@/lib/db/models/Status';
import Contact, { IContact as IContactDoc } from '@/lib/db/models/Contact';
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
import type { IMessage, MessageResponse } from '@/types/message';
import type { IChat } from '@/types/chat';
import type { IGroup } from '@/types/group';
import type { UserResponse } from '@/types/api';
import mongoose from 'mongoose';

// Type for populated Mongoose documents
type PopulatedMessageDoc = IMessageDoc & {
  senderId: {
    _id: string;
    displayName: string;
    avatar: string;
    username: string;
  };
  replyTo?: IMessageDoc;
  mediaId?: any;
};

type PopulatedChatDoc = IChatDoc & {
  participants: Array<{
    _id: string;
    displayName: string;
    avatar: string;
    isOnline: boolean;
  }>;
  groupInfo?: {
    name: string;
    description: string;
    avatar: string;
    admins: Array<{ _id: string }>;
    creator: string;
    inviteLink: string;
    settings: {
      onlyAdminsCanMessage: boolean;
      onlyAdminsCanEditGroupInfo: boolean;
      approvalRequired: boolean;
    };
  };
};

type PopulatedGroupDoc = IGroupDoc & {
  members: Array<{
    userId: { _id: string };
    role: string;
    joinedAt: Date;
    addedBy: string;
  }>;
};

type UserDoc = {
  _id: string;
  displayName: string;
  avatar: string;
  username: string;
  email: string;
  isOnline: boolean;
  lastSeen: Date;
  notificationSettings: {
    messageNotifications: boolean;
    callNotifications: boolean;
    groupNotifications: boolean;
    sound: string;
  };
  devices: Array<{
    platform: string;
    pushToken?: string;
  }>;
  contacts: Array<string>;
};

export class SocketHandlersService {
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private onlineUsers = new Map<string, { lastSeen: Date; socketIds: Set<string> }>();
  private userTypingStatus = new Map<string, Map<string, NodeJS.Timeout>>(); // userId -> chatId -> timeout

  constructor(io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {
    this.io = io;
    this.startHeartbeat();
  }

  // Helper method to transform populated user to UserResponse
  private transformUserToResponse(user: any): UserResponse {
    return {
      user: {
        _id: user._id.toString(),
        phoneNumber: user.phoneNumber || '',
        countryCode: user.countryCode || '',
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        avatar: user.avatar,
        about: user.about || '',
        isVerified: user.isVerified || false,
        isOnline: user.isOnline || false,
        lastSeen: user.lastSeen || new Date(),
        status: user.status || 'active',
        deviceTokens: user.deviceTokens || [],
        devices: user.devices || [],
        privacySettings: user.privacySettings || {
          lastSeen: 'everyone',
          profilePhoto: 'everyone',
          about: 'everyone',
          readReceipts: true,
          groups: 'everyone',
          calls: 'everyone',
          status: 'contacts'
        },
        securitySettings: user.securitySettings || {
          twoFactorEnabled: false,
          backupEnabled: false,
          disappearingMessages: 0,
          fingerprintLock: false,
          autoDownloadMedia: true
        },
        notificationSettings: user.notificationSettings || {
          messageNotifications: true,
          groupNotifications: true,
          callNotifications: true,
          statusNotifications: true,
          sound: 'default',
          vibration: true,
          popupNotification: true
        },
        contacts: user.contacts || [],
        blockedUsers: user.blockedUsers || [],
        tempOTP: user.tempOTP,
        tempOTPExpires: user.tempOTPExpires,
        createdAt: user.createdAt || new Date(),
        updatedAt: user.updatedAt || new Date()
      },
      isContact: user.isContact,
      mutualGroups: user.mutualGroups
    };
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
        .lean() as PopulatedChatDoc | null;

      if (!chat) {
        socket?.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Chat not found' });
        return;
      }

      // Check if user is participant
      if (!chat.participants.some((p) => p._id.toString() === senderId)) {
        socket?.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Not a chat participant' });
        return;
      }

      // Check group permissions
      if (chat.type === 'group' && chat.groupInfo?.settings?.onlyAdminsCanMessage) {
        const isAdmin = chat.groupInfo.admins?.some((admin) => admin._id.toString() === senderId);
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

      const savedMessage = await message.save();

      // Update chat last message
      await Chat.findByIdAndUpdate(chatId, {
        lastMessage: savedMessage._id,
        lastMessageTime: new Date(),
        $inc: { 'unreadCount.$[elem].count': 1 }
      }, {
        arrayFilters: [{ 'elem.userId': { $ne: senderId } }]
      });

      // Populate message for response
      const populatedMessage = await Message.findById(savedMessage._id)
        .populate('senderId', 'displayName avatar username')
        .populate('replyTo')
        .populate('mediaId')
        .lean() as PopulatedMessageDoc | null;

      if (!populatedMessage) {
        socket?.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Failed to retrieve message' });
        return;
      }

      // Transform sender to UserResponse
      const senderResponse = this.transformUserToResponse(populatedMessage.senderId);

      // Create MessageResponse
      const messageResponse: MessageResponse = {
        message: {
          _id: populatedMessage._id.toString(),
          chatId: populatedMessage.chatId.toString(),
          senderId: populatedMessage.senderId._id.toString(),
          type: populatedMessage.type as any,
          content: populatedMessage.content,
          mediaId: populatedMessage.mediaId?.toString(),
          location: populatedMessage.location,
          contact: populatedMessage.contact,
          replyTo: populatedMessage.replyTo?._id?.toString(),
          isForwarded: populatedMessage.isForwarded,
          forwardedFrom: populatedMessage.forwardedFrom?.toString(),
          forwardedTimes: populatedMessage.forwardedTimes,
          reactions: populatedMessage.reactions.map(r => ({
            userId: r.userId.toString(),
            emoji: r.emoji,
            createdAt: r.createdAt
          })),
          mentions: populatedMessage.mentions.map(m => m.toString()),
          status: populatedMessage.status as any,
          readBy: populatedMessage.readBy.map(r => ({
            userId: r.userId.toString(),
            readAt: r.readAt
          })),
          deliveredTo: populatedMessage.deliveredTo.map(d => ({
            userId: d.userId.toString(),
            deliveredAt: d.deliveredAt
          })),
          isEdited: populatedMessage.isEdited,
          editedAt: populatedMessage.editedAt,
          editHistory: populatedMessage.editHistory,
          isDeleted: populatedMessage.isDeleted,
          deletedAt: populatedMessage.deletedAt,
          deletedFor: populatedMessage.deletedFor.map(d => d.toString()),
          isStarred: populatedMessage.isStarred,
          starredBy: populatedMessage.starredBy.map(s => s.toString()),
          encryptedContent: populatedMessage.encryptedContent,
          disappearsAt: populatedMessage.disappearsAt,
          createdAt: populatedMessage.createdAt,
          updatedAt: populatedMessage.updatedAt
        },
        sender: senderResponse
      };

      // Emit to all chat participants
      chat.participants.forEach((participant) => {
        this.io.to(`user:${participant._id}`).emit(SOCKET_EVENTS.MESSAGE_NEW, messageResponse);
      });

      // Send push notifications to offline users
      await this.sendMessageNotifications(chat, populatedMessage, senderId);

      // Handle mentions
      if (messageData.mentions?.length > 0) {
        await this.handleMentions(messageData.mentions, populatedMessage, chat);
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

      const message = await Message.findById(messageId) as IMessageDoc | null;
      if (!message) return;

      // Add delivery receipt
      const existingDelivery = message.deliveredTo.find(d => d.userId.toString() === userId);
      if (!existingDelivery) {
        message.deliveredTo.push({
          userId: new mongoose.Types.ObjectId(userId),
          deliveredAt: new Date()
        });

        message.status = 'delivered';
        await message.save();

        // Notify sender
        this.io.to(`user:${message.senderId.toString()}`).emit(SOCKET_EVENTS.MESSAGE_DELIVERED, {
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

      const message = await Message.findById(messageId) as IMessageDoc | null;
      if (!message) return;

      // Add read receipt
      const existingRead = message.readBy.find(r => r.userId.toString() === userId);
      if (!existingRead) {
        message.readBy.push({
          userId: new mongoose.Types.ObjectId(userId),
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
        this.io.to(`user:${message.senderId.toString()}`).emit(SOCKET_EVENTS.MESSAGE_READ, {
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

      // Broadcast to all participants - use type assertion for missing event
      (call as any).participants.forEach((participant: any) => {
        this.io.to(`user:${participant.userId._id}`).emit('call:status_update' as keyof ServerToClientEvents, {
          callId,
          status,
          userId
        } as any);
      });

    } catch (error) {
      console.error('Error handling call status update:', error);
    }
  }

  // Group handlers
  async handleGroupMemberAdded(groupId: string, addedMembers: string[], addedBy: string): Promise<void> {
    try {
      await connectDB();

      const group = await Group.findById(groupId)
        .populate('members.userId')
        .lean() as PopulatedGroupDoc | null;
      
      if (!group) return;

      // Notify all current members
      group.members.forEach((member) => {
        this.io.to(`user:${member.userId._id}`).emit(SOCKET_EVENTS.CHAT_MEMBER_ADDED, {
          chatId: group.chatId.toString(),
          members: addedMembers
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

      const group = await Group.findById(groupId)
        .populate('members.userId')
        .lean() as PopulatedGroupDoc | null;
      
      if (!group) return;

      // Notify remaining members
      group.members.forEach((member) => {
        if (!removedMembers.includes(member.userId._id.toString())) {
          this.io.to(`user:${member.userId._id}`).emit(SOCKET_EVENTS.CHAT_MEMBER_REMOVED, {
            chatId: group.chatId.toString(),
            members: removedMembers
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
      const user = await User.findById(status.userId).populate('contacts').lean() as UserDoc | null;
      if (!user) return;

      let viewableBy: string[] = [];

      switch (status.privacy.type) {
        case 'everyone':
          viewableBy = user.contacts.map((c: any) => c._id?.toString() || c.toString());
          break;
        case 'contacts':
          viewableBy = user.contacts.map((c: any) => c._id?.toString() || c.toString());
          break;
        case 'contacts_except':
          viewableBy = user.contacts
            .filter((c: any) => {
              const contactId = c._id?.toString() || c.toString();
              return !status.privacy.excludedContacts?.includes(contactId);
            })
            .map((c: any) => c._id?.toString() || c.toString());
          break;
        case 'only_share_with':
          viewableBy = status.privacy.selectedContacts || [];
          break;
      }

      // Notify users who can view this status
      viewableBy.forEach(userId => {
        this.io.to(`user:${userId}`).emit(SOCKET_EVENTS.STATUS_NEW, {
          status,
          isViewed: false,
          viewCount: 0
        });
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
        this.io.to(`user:${contact.userId.toString()}`).emit(SOCKET_EVENTS.USER_ONLINE, {
          userId,
          isOnline,
          lastSeen: new Date()
        });
      });

    } catch (error) {
      console.error('Error broadcasting user presence:', error);
    }
  }

  private async sendMessageNotifications(chat: PopulatedChatDoc, message: PopulatedMessageDoc, senderId: string): Promise<void> {
    try {
      const sender = await User.findById(senderId).lean() as UserDoc | null;
      if (!sender) return;

      // Get offline participants
      const offlineParticipants = chat.participants.filter((p) => 
        p._id.toString() !== senderId && !this.isUserOnline(p._id.toString())
      );

      // Send notifications to offline users
      for (const participant of offlineParticipants) {
        // Get full user details for notification settings
        const participantUser = await User.findById(participant._id).lean() as UserDoc | null;
        if (!participantUser?.notificationSettings?.messageNotifications) continue;

        const isGroup = chat.type === 'group';
        const senderName = sender.displayName;
        const body = this.formatMessageContent(message);

        // Send push notifications
        await Promise.all([
          apnsService.sendMessageNotification(
            participant._id.toString(),
            chat._id.toString(),
            senderName,
            body,
            isGroup
          ),
          fcmService.sendNotification({
            deviceTokens: participantUser.devices
              .filter(d => (d.platform === 'android' || d.platform === 'web') && d.pushToken)
              .map(d => d.pushToken!),
            title: isGroup ? `${senderName} in Group` : senderName,
            body,
            sound: participantUser.notificationSettings?.sound || 'default',
            icon: '/icon-192x192.png',
            tag: `message_${chat._id}`,
            clickAction: `/chat/${chat._id}`,
            data: {
              type: 'message',
              chatId: chat._id.toString(),
              senderId: senderId,
              isGroup: isGroup.toString()
            },
            priority: 'high'
          })
        ]);
      }

    } catch (error) {
      console.error('Error sending message notifications:', error);
    }
  }

  private async sendCallNotifications(call: any): Promise<void> {
    try {
      const caller = await User.findById(call.callerId).lean() as UserDoc | null;
      if (!caller) return;

      // Send to all participants except caller
      for (const participant of call.participants) {
        if (participant.userId.toString() === call.callerId.toString()) continue;

        const user = await User.findById(participant.userId).lean() as UserDoc | null;
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
          fcmService.sendNotification({
            deviceTokens: user.devices
              .filter(d => (d.platform === 'android' || d.platform === 'web') && d.pushToken)
              .map(d => d.pushToken!),
            title: `Incoming ${call.type} call`,
            body: `${caller.displayName} is calling you${isGroup ? ' in group' : ''}`,
            sound: user.notificationSettings?.sound || 'default',
            icon: '/icon-192x192.png',
            tag: `call_${call._id}`,
            clickAction: `/call/${call._id}`,
            data: {
              type: 'call',
              callId: call._id.toString(),
              callerId: call.callerId.toString(),
              callType: call.type,
              isGroup: isGroup.toString()
            },
            priority: 'high'
          })
        ]);
      }

    } catch (error) {
      console.error('Error sending call notifications:', error);
    }
  }

  private async sendGroupJoinNotifications(group: PopulatedGroupDoc, newMembers: string[], addedBy: string): Promise<void> {
    try {
      const adder = await User.findById(addedBy).lean() as UserDoc | null;
      if (!adder) return;

      for (const memberId of newMembers) {
        const member = await User.findById(memberId).lean() as UserDoc | null;
        if (!member?.notificationSettings?.groupNotifications) continue;

        const title = `Added to ${group.name}`;
        const body = `${adder.displayName} added you to ${group.name}`;

        // Send basic notifications (using the existing sendNotification method)
        await Promise.all([
          apnsService.sendNotification({
            deviceTokens: member.devices
              .filter(d => d.platform === 'ios' && d.pushToken)
              .map(d => d.pushToken!),
            title,
            body,
            badge: 1,
            sound: 'default',
            data: {
              type: 'group_invite',
              groupId: group._id.toString(),
              addedBy: addedBy
            }
          }),
          fcmService.sendNotification({
            deviceTokens: member.devices
              .filter(d => (d.platform === 'android' || d.platform === 'web') && d.pushToken)
              .map(d => d.pushToken!),
            title,
            body,
            sound: 'default',
            icon: '/icon-192x192.png',
            tag: `group_invite_${group._id}`,
            clickAction: `/group/${group._id}`,
            data: {
              type: 'group_invite',
              groupId: group._id.toString(),
              addedBy: addedBy
            }
          })
        ]);
      }

    } catch (error) {
      console.error('Error sending group join notifications:', error);
    }
  }

  private async handleMentions(mentions: string[], message: PopulatedMessageDoc, chat: PopulatedChatDoc): Promise<void> {
    try {
      const sender = await User.findById(message.senderId._id).lean() as UserDoc | null;
      if (!sender) return;

      for (const mentionedUserId of mentions) {
        const mentionedUser = await User.findById(mentionedUserId).lean() as UserDoc | null;
        if (!mentionedUser?.notificationSettings?.messageNotifications) continue;

        const title = `${sender.displayName} mentioned you`;
        const body = this.formatMessageContent(message);

        // Send special mention notification - use type assertion for missing event
        this.io.to(`user:${mentionedUserId}`).emit('message:mention' as keyof ServerToClientEvents, {
          message,
          mentionedBy: this.transformUserToResponse(sender),
          chat
        } as any);

        // Send push notifications
        await Promise.all([
          apnsService.sendNotification({
            deviceTokens: mentionedUser.devices
              .filter(d => d.platform === 'ios' && d.pushToken)
              .map(d => d.pushToken!),
            title,
            body,
            badge: 1,
            sound: 'default',
            data: {
              type: 'mention',
              chatId: chat._id.toString(),
              messageId: message._id.toString(),
              mentionedBy: sender._id.toString()
            }
          }),
          fcmService.sendNotification({
            deviceTokens: mentionedUser.devices
              .filter(d => (d.platform === 'android' || d.platform === 'web') && d.pushToken)
              .map(d => d.pushToken!),
            title,
            body,
            sound: 'default',
            icon: '/icon-192x192.png',
            tag: `mention_${message._id}`,
            clickAction: `/chat/${chat._id}`,
            data: {
              type: 'mention',
              chatId: chat._id.toString(),
              messageId: message._id.toString(),
              mentionedBy: sender._id.toString()
            },
            priority: 'high'
          })
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

  private formatMessageContent(message: PopulatedMessageDoc): string {
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