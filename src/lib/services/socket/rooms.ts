import { Server, Socket } from 'socket.io';
import { connectDB } from '@/lib/db/connection';
import Chat from '@/lib/db/models/Chat';
import Group from '@/lib/db/models/Group';
import Call from '@/lib/db/models/Call';
import Admin from '@/lib/db/models/Admin';
import { SOCKET_EVENTS } from '@/lib/utils/constants';
import { analyticsTracker } from '../analytics/tracker';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  InterServerEvents, 
  SocketData 
} from '@/types/socket';
import type { SocketRoom } from '@/types/api';

// Define proper types for MongoDB documents
interface ChatDocument {
  _id: string;
  participants: string[];
  isActive?: boolean;
}

interface CallDocument {
  _id: string;
  participants: Array<{
    userId: string;
    status: string;
  }>;
  isActive?: boolean;
}

interface AdminDocument {
  _id: string;
  isActive: boolean;
  role: string;
}

interface GroupDocument {
  _id: string;
  members: Array<{
    userId: string;
  }>;
  chatId?: string;
  isActive: boolean;
}

export interface RoomInfo {
  roomId: string;
  type: 'user' | 'chat' | 'call' | 'admin' | 'broadcast';
  participants: Set<string>; // socket IDs
  metadata?: Record<string, any>;
  createdAt: Date;
  lastActivity: Date;
}

export class SocketRoomsManager {
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private rooms = new Map<string, RoomInfo>();
  private socketRooms = new Map<string, Set<string>>(); // socketId -> Set of roomIds
  private userSockets = new Map<string, Set<string>>(); // userId -> Set of socketIds

  constructor(io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {
    this.io = io;
    this.startRoomCleanup();
  }

  // User room management
  async joinUserRoom(socket: Socket, userId: string): Promise<void> {
    try {
      const roomId = this.getUserRoomName(userId);
      
      await socket.join(roomId);
      this.addSocketToRoom(socket.id, roomId, 'user');
      this.addUserSocket(userId, socket.id);

      // Track room activity
      this.updateRoomActivity(roomId);

      // Update socket data
      if (socket.data) {
        socket.data.joinedRooms.push(roomId);
      }

      console.log(`Socket ${socket.id} joined user room: ${roomId}`);

    } catch (error) {
      console.error('Error joining user room:', error);
      throw error;
    }
  }

  async leaveUserRoom(socket: Socket, userId: string): Promise<void> {
    try {
      const roomId = this.getUserRoomName(userId);
      
      await socket.leave(roomId);
      this.removeSocketFromRoom(socket.id, roomId);
      this.removeUserSocket(userId, socket.id);

      console.log(`Socket ${socket.id} left user room: ${roomId}`);

    } catch (error) {
      console.error('Error leaving user room:', error);
    }
  }

  // Chat room management
  async joinChatRoom(socket: Socket, chatId: string): Promise<void> {
    try {
      await connectDB();

      // Verify chat access with proper typing
      const chat = await Chat.findById(chatId).lean() as ChatDocument | null;
      if (!chat) {
        throw new Error('Chat not found');
      }

      const userId = socket.data?.userId;
      if (!userId || !chat.participants.includes(userId)) {
        throw new Error('Access denied to chat');
      }

      const roomId = this.getChatRoomName(chatId);
      
      await socket.join(roomId);
      this.addSocketToRoom(socket.id, roomId, 'chat', { chatId, userId });
      this.updateRoomActivity(roomId);

      // Update socket data
      if (socket.data) {
        socket.data.joinedRooms.push(roomId);
      }

      console.log(`Socket ${socket.id} joined chat room: ${roomId}`);

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        userId,
        'chat',
        'join_room',
        { chatId, roomId }
      );

    } catch (error) {
      console.error('Error joining chat room:', error);
      socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async leaveChatRoom(socket: Socket, chatId: string): Promise<void> {
    try {
      const roomId = this.getChatRoomName(chatId);
      
      await socket.leave(roomId);
      this.removeSocketFromRoom(socket.id, roomId);

      console.log(`Socket ${socket.id} left chat room: ${roomId}`);

    } catch (error) {
      console.error('Error leaving chat room:', error);
    }
  }

  // Call room management
  async joinCallRoom(socket: Socket, callId: string): Promise<void> {
    try {
      await connectDB();

      // Verify call access with proper typing
      const call = await Call.findById(callId).lean() as CallDocument | null;
      if (!call) {
        throw new Error('Call not found');
      }

      const userId = socket.data?.userId;
      if (!userId || !call.participants.some(p => p.userId === userId)) {
        throw new Error('Access denied to call');
      }

      const roomId = this.getCallRoomName(callId);
      
      await socket.join(roomId);
      this.addSocketToRoom(socket.id, roomId, 'call', { callId, userId });
      this.updateRoomActivity(roomId);

      // Update socket data
      if (socket.data) {
        socket.data.joinedRooms.push(roomId);
      }

      console.log(`Socket ${socket.id} joined call room: ${roomId}`);

      // Notify other participants
      socket.to(roomId).emit(SOCKET_EVENTS.CALL_PARTICIPANT_JOINED, {
        callId,
        participant: { userId }
      });

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        userId,
        'call',
        'join_room',
        { callId, roomId }
      );

    } catch (error) {
      console.error('Error joining call room:', error);
      socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async leaveCallRoom(socket: Socket, callId: string): Promise<void> {
    try {
      const roomId = this.getCallRoomName(callId);
      const userId = socket.data?.userId;
      
      await socket.leave(roomId);
      this.removeSocketFromRoom(socket.id, roomId);

      // Notify other participants
      if (userId) {
        socket.to(roomId).emit(SOCKET_EVENTS.CALL_PARTICIPANT_LEFT, {
          callId,
          userId
        });
      }

      console.log(`Socket ${socket.id} left call room: ${roomId}`);

    } catch (error) {
      console.error('Error leaving call room:', error);
    }
  }

  // Admin room management
  async joinAdminRoom(socket: Socket, adminId: string): Promise<void> {
    try {
      await connectDB();

      // Verify admin access with proper typing
      const admin = await Admin.findById(adminId).lean() as AdminDocument | null;
      if (!admin || !admin.isActive) {
        throw new Error('Admin access denied');
      }

      const roomId = this.getAdminRoomName();
      
      await socket.join(roomId);
      this.addSocketToRoom(socket.id, roomId, 'admin', { adminId, role: admin.role });
      this.updateRoomActivity(roomId);

      // Update socket data
      if (socket.data) {
        socket.data.joinedRooms.push(roomId);
      }

      console.log(`Admin ${adminId} joined admin room: ${roomId}`);

      // Notify other admins using proper event type
      socket.to(roomId).emit('admin:user_joined' as keyof ServerToClientEvents, {
        adminId,
        role: admin.role,
        timestamp: new Date()
      } as any);

    } catch (error) {
      console.error('Error joining admin room:', error);
      socket.emit(SOCKET_EVENTS.SYSTEM_ERROR, { error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async leaveAdminRoom(socket: Socket, adminId: string): Promise<void> {
    try {
      const roomId = this.getAdminRoomName();
      
      await socket.leave(roomId);
      this.removeSocketFromRoom(socket.id, roomId);

      // Notify other admins using proper event type
      socket.to(roomId).emit('admin:user_left' as keyof ServerToClientEvents, {
        adminId,
        timestamp: new Date()
      } as any);

      console.log(`Admin ${adminId} left admin room: ${roomId}`);

    } catch (error) {
      console.error('Error leaving admin room:', error);
    }
  }

  // Broadcasting methods with proper event typing
  broadcastToUserRoom<K extends keyof ServerToClientEvents>(
    userId: string, 
    event: K, 
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    const roomId = this.getUserRoomName(userId);
    this.io.to(roomId).emit(event, ...args);
    this.updateRoomActivity(roomId);
  }

  broadcastToChatRoom<K extends keyof ServerToClientEvents>(
    chatId: string, 
    event: K, 
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    const roomId = this.getChatRoomName(chatId);
    this.io.to(roomId).emit(event, ...args);
    this.updateRoomActivity(roomId);
  }

  broadcastToCallRoom<K extends keyof ServerToClientEvents>(
    callId: string, 
    event: K, 
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    const roomId = this.getCallRoomName(callId);
    this.io.to(roomId).emit(event, ...args);
    this.updateRoomActivity(roomId);
  }

  broadcastToAdminRoom<K extends keyof ServerToClientEvents>(
    event: K, 
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    const roomId = this.getAdminRoomName();
    this.io.to(roomId).emit(event, ...args);
    this.updateRoomActivity(roomId);
  }

  broadcastToAll<K extends keyof ServerToClientEvents>(
    event: K, 
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    this.io.emit(event, ...args);
  }

  // Group-specific methods
  async joinGroupRooms(socket: Socket, userId: string): Promise<void> {
    try {
      await connectDB();

      // Get user's groups with proper typing
      const groups = await Group.find({ 
        'members.userId': userId,
        isActive: true 
      }).lean() as unknown as GroupDocument[];

      // Join all group chat rooms
      for (const group of groups) {
        if (group.chatId) {
          await this.joinChatRoom(socket, group.chatId.toString());
        }
      }

      console.log(`Socket ${socket.id} joined ${groups.length} group rooms`);

    } catch (error) {
      console.error('Error joining group rooms:', error);
    }
  }

  // Room cleanup and management
  async clearCallRoom(callId: string): Promise<void> {
    try {
      const roomId = this.getCallRoomName(callId);
      const room = this.rooms.get(roomId);

      if (room) {
        // Remove all sockets from the room
        room.participants.forEach(socketId => {
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket) {
            socket.leave(roomId);
          }
          this.removeSocketFromRoom(socketId, roomId);
        });

        // Remove room
        this.rooms.delete(roomId);
      }

      console.log(`Cleared call room: ${roomId}`);

    } catch (error) {
      console.error('Error clearing call room:', error);
    }
  }

  async handleSocketDisconnect(socket: Socket): Promise<void> {
    try {
      const socketId = socket.id;
      const userId = socket.data?.userId;
      const joinedRooms = this.socketRooms.get(socketId) || new Set();

      // Remove socket from all rooms
      joinedRooms.forEach(roomId => {
        this.removeSocketFromRoom(socketId, roomId);
      });

      // Remove from user sockets
      if (userId) {
        this.removeUserSocket(userId, socketId);
      }

      console.log(`Socket ${socketId} disconnected and removed from ${joinedRooms.size} rooms`);

    } catch (error) {
      console.error('Error handling socket disconnect:', error);
    }
  }

  // Room name generators
  getUserRoomName(userId: string): SocketRoom {
    return `user:${userId}`;
  }

  getChatRoomName(chatId: string): SocketRoom {
    return `chat:${chatId}`;
  }

  getCallRoomName(callId: string): SocketRoom {
    return `call:${callId}`;
  }

  getAdminRoomName(): SocketRoom {
    return 'admin:main';
  }

  // Private helper methods
  private addSocketToRoom(socketId: string, roomId: string, type: RoomInfo['type'], metadata?: Record<string, any>): void {
    // Add to rooms map
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        roomId,
        type,
        participants: new Set(),
        metadata,
        createdAt: new Date(),
        lastActivity: new Date()
      });
    }

    const room = this.rooms.get(roomId)!;
    room.participants.add(socketId);

    // Add to socket rooms map
    if (!this.socketRooms.has(socketId)) {
      this.socketRooms.set(socketId, new Set());
    }
    this.socketRooms.get(socketId)!.add(roomId);
  }

  private removeSocketFromRoom(socketId: string, roomId: string): void {
    // Remove from rooms map
    const room = this.rooms.get(roomId);
    if (room) {
      room.participants.delete(socketId);

      // Remove room if empty
      if (room.participants.size === 0) {
        this.rooms.delete(roomId);
      }
    }

    // Remove from socket rooms map
    const socketRooms = this.socketRooms.get(socketId);
    if (socketRooms) {
      socketRooms.delete(roomId);

      // Remove socket entry if no rooms
      if (socketRooms.size === 0) {
        this.socketRooms.delete(socketId);
      }
    }
  }

  private addUserSocket(userId: string, socketId: string): void {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socketId);
  }

  private removeUserSocket(userId: string, socketId: string): void {
    const userSocketSet = this.userSockets.get(userId);
    if (userSocketSet) {
      userSocketSet.delete(socketId);

      // Remove user entry if no sockets
      if (userSocketSet.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  private updateRoomActivity(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.lastActivity = new Date();
    }
  }

  private startRoomCleanup(): void {
    // Clean up inactive rooms every 5 minutes
    setInterval(() => {
      const now = new Date();
      const inactivityThreshold = 30 * 60 * 1000; // 30 minutes

      this.rooms.forEach((room, roomId) => {
        const inactiveTime = now.getTime() - room.lastActivity.getTime();
        
        if (inactiveTime > inactivityThreshold && room.participants.size === 0) {
          this.rooms.delete(roomId);
          console.log(`Cleaned up inactive room: ${roomId}`);
        }
      });
    }, 5 * 60 * 1000);
  }

  // Public getters and statistics
  getRoomInfo(roomId: string): RoomInfo | null {
    return this.rooms.get(roomId) || null;
  }

  getRoomParticipantCount(roomId: string): number {
    return this.rooms.get(roomId)?.participants.size || 0;
  }

  getUserSocketCount(userId: string): number {
    return this.userSockets.get(userId)?.size || 0;
  }

  isUserConnected(userId: string): boolean {
    return this.userSockets.has(userId);
  }

  getTotalRoomsCount(): number {
    return this.rooms.size;
  }

  getTotalConnectedUsers(): number {
    return this.userSockets.size;
  }

  getRoomsByType(type: RoomInfo['type']): RoomInfo[] {
    return Array.from(this.rooms.values()).filter(room => room.type === type);
  }

  getSocketRooms(socketId: string): string[] {
    return Array.from(this.socketRooms.get(socketId) || []);
  }

  getUserSockets(userId: string): string[] {
    return Array.from(this.userSockets.get(userId) || []);
  }

  getRoomStatistics(): {
    totalRooms: number;
    roomsByType: Record<string, number>;
    totalParticipants: number;
    averageParticipantsPerRoom: number;
    connectedUsers: number;
  } {
    const roomsByType: Record<string, number> = {};
    let totalParticipants = 0;

    this.rooms.forEach(room => {
      roomsByType[room.type] = (roomsByType[room.type] || 0) + 1;
      totalParticipants += room.participants.size;
    });

    return {
      totalRooms: this.rooms.size,
      roomsByType,
      totalParticipants,
      averageParticipantsPerRoom: this.rooms.size > 0 ? totalParticipants / this.rooms.size : 0,
      connectedUsers: this.userSockets.size
    };
  }
}