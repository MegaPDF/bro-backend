import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import Message from '@/lib/db/models/Message';
import Chat from '@/lib/db/models/Chat';
import Call from '@/lib/db/models/Call';
import Status from '@/lib/db/models/Status';
import Notification from '@/lib/db/models/Notification';
import { SOCKET_EVENTS, ERROR_CODES } from '@/lib/utils/constants';
import { analyticsTracker } from '../analytics/tracker';
import { SocketRoomsManager } from './rooms';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  InterServerEvents, 
  SocketData 
} from '@/types/socket';
import type { JWTPayload } from '@/types/auth';

export interface AuthenticatedSocket extends Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> {
  userId: string;
  deviceId: string;
}

export class SocketEventsService {
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private roomsManager: SocketRoomsManager;
  private connectedUsers = new Map<string, Set<string>>(); // userId -> Set of socketIds
  private typingUsers = new Map<string, Set<string>>(); // chatId -> Set of userIds

  constructor(io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {
    this.io = io;
    this.roomsManager = new SocketRoomsManager(io);
    this.setupEventHandlers();
  }

  // Setup all socket event handlers
  private setupEventHandlers(): void {
    this.io.use(this.authenticationMiddleware.bind(this));
    
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      this.handleConnection(socket);
      this.setupSocketEventListeners(socket);
    });
  }

  // Authentication middleware
  private async authenticationMiddleware(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    next: (err?: Error) => void
  ): Promise<void> {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
      
      // Check if user exists and is active
      await connectDB();
      const user = await User.findById(decoded.userId).lean();
      
      if (!user || user.status !== 'active') {
        return next(new Error('Invalid user or user not active'));
      }

      // Attach user data to socket
      (socket as AuthenticatedSocket).userId = decoded.userId;
      (socket as AuthenticatedSocket).deviceId = decoded.deviceId;
      socket.data = {
        userId: decoded.userId,
        deviceId: decoded.deviceId,
        isAuthenticated: true,
        joinedRooms: []
      };

      next();
    } catch (error: any) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  }

  // Handle new socket connection
  private async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    try {
      console.log(`User ${socket.userId} connected with socket ${socket.id}`);

      // Track user connection
      if (!this.connectedUsers.has(socket.userId)) {
        this.connectedUsers.set(socket.userId, new Set());
      }
      this.connectedUsers.get(socket.userId)!.add(socket.id);

      // Update user online status
      await this.updateUserOnlineStatus(socket.userId, true);

      // Join user room for personal notifications
      await this.roomsManager.joinUserRoom(socket, socket.userId);

      // Emit user online status to contacts
      await this.broadcastUserOnlineStatus(socket.userId, true);

      // Track analytics
      await analyticsTracker.trackUserActivity(
        socket.userId,
        'socket_connected',
        { deviceId: socket.deviceId, socketId: socket.id }
      );

    } catch (error) {
      console.error('Error handling socket connection:', error);
      socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Connection setup failed' });
    }
  }

  // Setup event listeners for a socket
  private setupSocketEventListeners(socket: AuthenticatedSocket): void {
    // Authentication events
    socket.on(SOCKET_EVENTS.AUTH_LOGOUT, () => this.handleLogout(socket));

    // Message events
    socket.on(SOCKET_EVENTS.MESSAGE_SEND, (data) => this.handleMessageSend(socket, data));
    socket.on(SOCKET_EVENTS.MESSAGE_EDIT, (data) => this.handleMessageEdit(socket, data));
    socket.on(SOCKET_EVENTS.MESSAGE_DELETED, (data) => this.handleMessageDelete(socket, data));
    socket.on(SOCKET_EVENTS.MESSAGE_REACT, (data) => this.handleMessageReaction(socket, data));
    socket.on(SOCKET_EVENTS.MESSAGE_READ, (data) => this.handleMessageRead(socket, data));

    // Chat events
    socket.on(SOCKET_EVENTS.CHAT_TYPING, (data) => this.handleTyping(socket, data));
    socket.on(SOCKET_EVENTS.CHAT_JOIN, (data) => this.handleChatJoin(socket, data));
    socket.on(SOCKET_EVENTS.CHAT_LEAVE, (data) => this.handleChatLeave(socket, data));

    // Call events
    socket.on(SOCKET_EVENTS.CALL_INITIATE, (data) => this.handleCallInitiate(socket, data));
    socket.on(SOCKET_EVENTS.CALL_ACCEPT, (data) => this.handleCallAccept(socket, data));
    socket.on(SOCKET_EVENTS.CALL_DECLINE, (data) => this.handleCallDecline(socket, data));
    socket.on(SOCKET_EVENTS.CALL_END, (data) => this.handleCallEnd(socket, data));
    socket.on(SOCKET_EVENTS.CALL_WEBRTC_SIGNAL, (data) => this.handleWebRTCSignal(socket, data));

    // Status events
    socket.on(SOCKET_EVENTS.STATUS_VIEW, (data) => this.handleStatusView(socket, data));

    // User events
    socket.on(SOCKET_EVENTS.USER_UPDATE_PRESENCE, (data) => this.handleUpdatePresence(socket, data));

    // Disconnect event
    socket.on('disconnect', () => this.handleDisconnect(socket));
  }

  // Handle logout
  private async handleLogout(socket: AuthenticatedSocket): Promise<void> {
    try {
      await this.updateUserOnlineStatus(socket.userId, false);
      await this.broadcastUserOnlineStatus(socket.userId, false);
      
      // Remove from connected users
      const userSockets = this.connectedUsers.get(socket.userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          this.connectedUsers.delete(socket.userId);
        }
      }

      socket.disconnect(true);
    } catch (error) {
      console.error('Error handling logout:', error);
    }
  }

  // Handle message sending
  private async handleMessageSend(socket: AuthenticatedSocket, data: any): Promise<void> {
    try {
      await connectDB();

      // Validate chat access
      const chat = await Chat.findById(data.chatId);
      if (!chat || !chat.participants.includes(socket.userId)) {
        socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Access denied to chat' });
        return;
      }

      // Create message
      const message = new Message({
        chatId: data.chatId,
        senderId: socket.userId,
        type: data.type,
        content: data.content,
        mediaId: data.mediaId,
        location: data.location,
        contact: data.contact,
        replyTo: data.replyTo,
        mentions: data.mentions
      });

      await message.save();

      // Update chat's last message
      await Chat.findByIdAndUpdate(data.chatId, {
        lastMessage: message._id,
        lastMessageTime: new Date()
      });

      // Populate message data
      const populatedMessage = await Message.findById(message._id)
        .populate('senderId', 'displayName avatar')
        .populate('replyTo')
        .lean();

      // Emit to all chat participants
      this.roomsManager.broadcastToChatRoom(data.chatId, SOCKET_EVENTS.MESSAGE_NEW, {
        message: populatedMessage,
        sender: populatedMessage.senderId
      });

      // Track analytics
      await analyticsTracker.trackMessage(
        socket.userId,
        data.chatId,
        data.type,
        { size: data.content?.length || 0 }
      );

    } catch (error) {
      console.error('Error handling message send:', error);
      socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Failed to send message' });
    }
  }

  // Handle message editing
  private async handleMessageEdit(socket: AuthenticatedSocket, data: { messageId: string; content: string }): Promise<void> {
    try {
      await connectDB();

      const message = await Message.findById(data.messageId);
      if (!message || message.senderId.toString() !== socket.userId) {
        socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Cannot edit this message' });
        return;
      }

      // Check edit time limit (15 minutes)
      const editTimeLimit = 15 * 60 * 1000;
      if (Date.now() - message.createdAt.getTime() > editTimeLimit) {
        socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Edit time limit exceeded' });
        return;
      }

      // Save edit history
      message.editHistory.push({
        content: message.content,
        editedAt: new Date()
      });

      message.content = data.content;
      message.isEdited = true;
      message.editedAt = new Date();

      await message.save();

      const populatedMessage = await Message.findById(message._id)
        .populate('senderId', 'displayName avatar')
        .lean();

      // Broadcast updated message
      this.roomsManager.broadcastToChatRoom(message.chatId.toString(), SOCKET_EVENTS.MESSAGE_UPDATED, {
        message: populatedMessage
      });

    } catch (error) {
      console.error('Error handling message edit:', error);
      socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Failed to edit message' });
    }
  }

  // Handle message deletion
  private async handleMessageDelete(socket: AuthenticatedSocket, data: { messageId: string; deleteForEveryone: boolean }): Promise<void> {
    try {
      await connectDB();

      const message = await Message.findById(data.messageId);
      if (!message || message.senderId.toString() !== socket.userId) {
        socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Cannot delete this message' });
        return;
      }

      if (data.deleteForEveryone) {
        message.isDeleted = true;
        message.deletedAt = new Date();
        message.content = 'This message was deleted';
      } else {
        if (!message.deletedFor.includes(socket.userId)) {
          message.deletedFor.push(socket.userId);
        }
      }

      await message.save();

      // Broadcast deletion
      if (data.deleteForEveryone) {
        this.roomsManager.broadcastToChatRoom(message.chatId.toString(), SOCKET_EVENTS.MESSAGE_DELETED, {
          messageId: data.messageId,
          chatId: message.chatId.toString()
        });
      }

    } catch (error) {
      console.error('Error handling message delete:', error);
      socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Failed to delete message' });
    }
  }

  // Handle message reactions
  private async handleMessageReaction(socket: AuthenticatedSocket, data: { messageId: string; emoji: string }): Promise<void> {
    try {
      await connectDB();

      const message = await Message.findById(data.messageId);
      if (!message) {
        socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Message not found' });
        return;
      }

      // Check if user already reacted with this emoji
      const existingReaction = message.reactions.find(
        r => r.userId.toString() === socket.userId && r.emoji === data.emoji
      );

      if (existingReaction) {
        // Remove reaction
        message.reactions = message.reactions.filter(
          r => !(r.userId.toString() === socket.userId && r.emoji === data.emoji)
        );
      } else {
        // Add reaction
        message.reactions.push({
          userId: socket.userId,
          emoji: data.emoji,
          createdAt: new Date()
        });
      }

      await message.save();

      // Broadcast reaction
      this.roomsManager.broadcastToChatRoom(message.chatId.toString(), SOCKET_EVENTS.MESSAGE_REACTION, {
        messageId: data.messageId,
        reaction: {
          userId: socket.userId,
          emoji: data.emoji,
          createdAt: new Date()
        }
      });

    } catch (error) {
      console.error('Error handling message reaction:', error);
      socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Failed to react to message' });
    }
  }

  // Handle message read receipts
  private async handleMessageRead(socket: AuthenticatedSocket, data: { messageId: string; chatId: string }): Promise<void> {
    try {
      await connectDB();

      const message = await Message.findById(data.messageId);
      if (!message) return;

      // Add read receipt if not already read
      const existingRead = message.readBy.find(r => r.userId.toString() === socket.userId);
      if (!existingRead) {
        message.readBy.push({
          userId: socket.userId,
          readAt: new Date()
        });

        await message.save();

        // Broadcast read receipt
        this.roomsManager.broadcastToChatRoom(data.chatId, SOCKET_EVENTS.MESSAGE_READ, {
          messageId: data.messageId,
          userId: socket.userId,
          readAt: new Date()
        });
      }

    } catch (error) {
      console.error('Error handling message read:', error);
    }
  }

  // Handle typing indicators
  private async handleTyping(socket: AuthenticatedSocket, data: { chatId: string; isTyping: boolean }): Promise<void> {
    try {
      if (!this.typingUsers.has(data.chatId)) {
        this.typingUsers.set(data.chatId, new Set());
      }

      const typingInChat = this.typingUsers.get(data.chatId)!;

      if (data.isTyping) {
        typingInChat.add(socket.userId);
      } else {
        typingInChat.delete(socket.userId);
      }

      // Broadcast typing status to other chat participants
      socket.to(this.roomsManager.getChatRoomName(data.chatId)).emit(SOCKET_EVENTS.CHAT_TYPING, {
        chatId: data.chatId,
        userId: socket.userId,
        isTyping: data.isTyping
      });

      // Auto-clear typing after 3 seconds
      if (data.isTyping) {
        setTimeout(() => {
          typingInChat.delete(socket.userId);
          socket.to(this.roomsManager.getChatRoomName(data.chatId)).emit(SOCKET_EVENTS.CHAT_TYPING, {
            chatId: data.chatId,
            userId: socket.userId,
            isTyping: false
          });
        }, 3000);
      }

    } catch (error) {
      console.error('Error handling typing:', error);
    }
  }

  // Handle chat join
  private async handleChatJoin(socket: AuthenticatedSocket, data: { chatId: string }): Promise<void> {
    try {
      await connectDB();

      const chat = await Chat.findById(data.chatId);
      if (!chat || !chat.participants.includes(socket.userId)) {
        socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Access denied to chat' });
        return;
      }

      await this.roomsManager.joinChatRoom(socket, data.chatId);

    } catch (error) {
      console.error('Error handling chat join:', error);
      socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Failed to join chat' });
    }
  }

  // Handle chat leave
  private async handleChatLeave(socket: AuthenticatedSocket, data: { chatId: string }): Promise<void> {
    try {
      await this.roomsManager.leaveChatRoom(socket, data.chatId);
    } catch (error) {
      console.error('Error handling chat leave:', error);
    }
  }

  // Handle call initiation
  private async handleCallInitiate(socket: AuthenticatedSocket, data: any): Promise<void> {
    try {
      await connectDB();

      // Create call record
      const call = new Call({
        type: data.type,
        callType: data.callType,
        callerId: socket.userId,
        participants: data.participants.map((id: string) => ({
          userId: id,
          status: 'calling'
        })),
        chatId: data.chatId,
        groupId: data.groupId,
        status: 'initiated'
      });

      await call.save();

      const populatedCall = await Call.findById(call._id)
        .populate('callerId', 'displayName avatar')
        .populate('participants.userId', 'displayName avatar')
        .lean();

      // Notify participants
      data.participants.forEach((participantId: string) => {
        this.roomsManager.broadcastToUserRoom(participantId, SOCKET_EVENTS.CALL_INCOMING, {
          call: populatedCall
        });
      });

      // Track analytics
      await analyticsTracker.trackCall(
        socket.userId,
        data.type,
        0,
        data.participants.length
      );

    } catch (error) {
      console.error('Error handling call initiate:', error);
      socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Failed to initiate call' });
    }
  }

  // Handle call accept
  private async handleCallAccept(socket: AuthenticatedSocket, data: { callId: string }): Promise<void> {
    try {
      await connectDB();

      const call = await Call.findById(data.callId);
      if (!call) {
        socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Call not found' });
        return;
      }

      // Update participant status
      const participant = call.participants.find(p => p.userId.toString() === socket.userId);
      if (participant) {
        participant.status = 'connected';
        participant.joinedAt = new Date();
      }

      call.status = 'connected';
      await call.save();

      // Join call room
      await this.roomsManager.joinCallRoom(socket, data.callId);

      // Notify all participants
      this.roomsManager.broadcastToCallRoom(data.callId, SOCKET_EVENTS.CALL_ACCEPTED, {
        callId: data.callId,
        userId: socket.userId
      });

    } catch (error) {
      console.error('Error handling call accept:', error);
      socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: 'Failed to accept call' });
    }
  }

  // Handle call decline
  private async handleCallDecline(socket: AuthenticatedSocket, data: { callId: string }): Promise<void> {
    try {
      await connectDB();

      const call = await Call.findById(data.callId);
      if (!call) return;

      // Update participant status
      const participant = call.participants.find(p => p.userId.toString() === socket.userId);
      if (participant) {
        participant.status = 'declined';
      }

      await call.save();

      // Notify all participants
      this.roomsManager.broadcastToCallRoom(data.callId, SOCKET_EVENTS.CALL_DECLINED, {
        callId: data.callId,
        userId: socket.userId
      });

    } catch (error) {
      console.error('Error handling call decline:', error);
    }
  }

  // Handle call end
  private async handleCallEnd(socket: AuthenticatedSocket, data: { callId: string; endReason: string }): Promise<void> {
    try {
      await connectDB();

      const call = await Call.findById(data.callId);
      if (!call) return;

      call.status = 'ended';
      call.endTime = new Date();
      call.duration = Math.floor((call.endTime.getTime() - call.startTime.getTime()) / 1000);
      call.endReason = data.endReason as any;

      await call.save();

      // Notify all participants
      this.roomsManager.broadcastToCallRoom(data.callId, SOCKET_EVENTS.CALL_ENDED, {
        callId: data.callId,
        endReason: data.endReason
      });

      // Remove all participants from call room
      this.roomsManager.clearCallRoom(data.callId);

    } catch (error) {
      console.error('Error handling call end:', error);
    }
  }

  // Handle WebRTC signaling
  private async handleWebRTCSignal(socket: AuthenticatedSocket, data: { callId: string; signal: any; targetUserId: string }): Promise<void> {
    try {
      // Forward WebRTC signal to target user
      this.roomsManager.broadcastToUserRoom(data.targetUserId, SOCKET_EVENTS.CALL_WEBRTC_SIGNAL, {
        callId: data.callId,
        signal: data.signal,
        fromUserId: socket.userId
      });

    } catch (error) {
      console.error('Error handling WebRTC signal:', error);
    }
  }

  // Handle status view
  private async handleStatusView(socket: AuthenticatedSocket, data: { statusId: string }): Promise<void> {
    try {
      await connectDB();

      const status = await Status.findById(data.statusId);
      if (!status || !status.isActive) return;

      // Add viewer if not already viewed
      const existingViewer = status.viewers.find(v => v.userId.toString() === socket.userId);
      if (!existingViewer) {
        status.viewers.push({
          userId: socket.userId,
          viewedAt: new Date()
        });

        await status.save();

        // Notify status owner
        this.roomsManager.broadcastToUserRoom(status.userId.toString(), SOCKET_EVENTS.STATUS_VIEWED, {
          statusId: data.statusId,
          viewer: {
            userId: socket.userId,
            viewedAt: new Date()
          }
        });
      }

    } catch (error) {
      console.error('Error handling status view:', error);
    }
  }

  // Handle presence update
  private async handleUpdatePresence(socket: AuthenticatedSocket, data: { isOnline: boolean }): Promise<void> {
    try {
      await this.updateUserOnlineStatus(socket.userId, data.isOnline);
      await this.broadcastUserOnlineStatus(socket.userId, data.isOnline);
    } catch (error) {
      console.error('Error handling presence update:', error);
    }
  }

  // Handle socket disconnect
  private async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    try {
      console.log(`User ${socket.userId} disconnected from socket ${socket.id}`);

      // Remove from connected users
      const userSockets = this.connectedUsers.get(socket.userId);
      if (userSockets) {
        userSockets.delete(socket.id);

        // If no more sockets for this user, mark as offline
        if (userSockets.size === 0) {
          this.connectedUsers.delete(socket.userId);
          await this.updateUserOnlineStatus(socket.userId, false);
          await this.broadcastUserOnlineStatus(socket.userId, false);
        }
      }

      // Clear typing status
      this.typingUsers.forEach((typingUsers, chatId) => {
        if (typingUsers.has(socket.userId)) {
          typingUsers.delete(socket.userId);
          socket.to(this.roomsManager.getChatRoomName(chatId)).emit(SOCKET_EVENTS.CHAT_TYPING, {
            chatId,
            userId: socket.userId,
            isTyping: false
          });
        }
      });

      // Track analytics
      await analyticsTracker.trackUserActivity(
        socket.userId,
        'socket_disconnected',
        { deviceId: socket.deviceId, socketId: socket.id }
      );

    } catch (error) {
      console.error('Error handling socket disconnect:', error);
    }
  }

  // Update user online status in database
  private async updateUserOnlineStatus(userId: string, isOnline: boolean): Promise<void> {
    try {
      await connectDB();

      await User.findByIdAndUpdate(userId, {
        isOnline,
        lastSeen: new Date()
      });

    } catch (error) {
      console.error('Error updating user online status:', error);
    }
  }

  // Broadcast user online status to contacts
  private async broadcastUserOnlineStatus(userId: string, isOnline: boolean): Promise<void> {
    try {
      await connectDB();

      const user = await User.findById(userId).select('contacts').lean();
      if (!user) return;

      // Notify all contacts
      user.contacts.forEach((contactId: any) => {
        this.roomsManager.broadcastToUserRoom(contactId.toString(), SOCKET_EVENTS.USER_ONLINE, {
          userId,
          isOnline,
          lastSeen: new Date()
        });
      });

    } catch (error) {
      console.error('Error broadcasting user online status:', error);
    }
  }

  // Get connected users count
  getConnectedUsersCount(): number {
    return this.connectedUsers.size;
  }

  // Get user socket count
  getUserSocketCount(userId: string): number {
    return this.connectedUsers.get(userId)?.size || 0;
  }

  // Check if user is connected
  isUserConnected(userId: string): boolean {
    return this.connectedUsers.has(userId);
  }
}