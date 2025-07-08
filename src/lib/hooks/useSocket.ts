// src/hooks/useSocket.ts

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { toast } from 'react-hot-toast';
import { useAuth } from './useAuth';
import { SOCKET_EVENTS } from '@/lib/utils/constants';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  InterServerEvents, 
  SocketData 
} from '@/types/socket';
import type { IMessage } from '@/types/message';
import type { IChat } from '@/types/chat';
import type { AuthUser } from '@/types/auth';

// Socket connection state
export interface SocketState {
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  error: string | null;
  lastConnectedAt: Date | null;
  reconnectAttempts: number;
}

// Online users state
export interface OnlineUsersState {
  users: Map<string, AuthUser>;
  count: number;
}

// Typing indicators state
export interface TypingState {
  typingUsers: Map<string, Set<string>>; // chatId -> Set of userIds
  isTyping: Map<string, boolean>; // chatId -> isTyping
}

// Call state
export interface CallState {
  activeCall: any | null;
  incomingCall: any | null;
  isInCall: boolean;
  isMuted: boolean;
  isVideoOn: boolean;
  participants: any[];
}

// Hook configuration
export interface UseSocketOptions {
  autoConnect?: boolean;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  timeout?: number;
}

// Event handlers interface
export interface SocketEventHandlers {
  onMessage?: (message: IMessage) => void;
  onMessageUpdate?: (message: IMessage) => void;
  onMessageDelete?: (messageId: string, chatId: string) => void;
  onChatUpdate?: (chat: IChat) => void;
  onUserOnline?: (user: AuthUser) => void;
  onUserOffline?: (userId: string) => void;
  onTypingStart?: (chatId: string, userId: string, user: AuthUser) => void;
  onTypingStop?: (chatId: string, userId: string) => void;
  onCallIncoming?: (call: any) => void;
  onCallUpdate?: (call: any) => void;
  onCallEnd?: (call: any) => void;
  onStatusUpdate?: (status: any) => void;
  onNotification?: (notification: any) => void;
  onError?: (error: string) => void;
}

export function useSocket(
  options: UseSocketOptions = {},
  eventHandlers: SocketEventHandlers = {}
) {
  const {
    autoConnect = true,
    reconnect = true,
    maxReconnectAttempts = 5,
    reconnectDelay = 1000,
    timeout = 10000
  } = options;

  const { authState } = useAuth();
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);

  // Socket state
  const [socketState, setSocketState] = useState<SocketState>({
    isConnected: false,
    isConnecting: false,
    isReconnecting: false,
    error: null,
    lastConnectedAt: null,
    reconnectAttempts: 0
  });

  // Online users state
  const [onlineUsers, setOnlineUsers] = useState<OnlineUsersState>({
    users: new Map(),
    count: 0
  });

  // Typing state
  const [typingState, setTypingState] = useState<TypingState>({
    typingUsers: new Map(),
    isTyping: new Map()
  });

  // Call state
  const [callState, setCallState] = useState<CallState>({
    activeCall: null,
    incomingCall: null,
    isInCall: false,
    isMuted: false,
    isVideoOn: false,
    participants: []
  });

  // Reconnection timer ref
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const typingTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Connect to socket
  const connect = useCallback(() => {
    if (socketRef.current?.connected || socketState.isConnecting || !authState.isAuthenticated) {
      return;
    }

    setSocketState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || '', {
        auth: {
          token: authState.sessionId
        },
        timeout,
        reconnection: false, // We handle reconnection manually
        transports: ['websocket', 'polling']
      });

      socketRef.current = socket;

      // Connection events
      socket.on('connect', () => {
        console.log('Socket connected:', socket.id);
        setSocketState({
          isConnected: true,
          isConnecting: false,
          isReconnecting: false,
          error: null,
          lastConnectedAt: new Date(),
          reconnectAttempts: 0
        });

        // Clear reconnection timer
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      });

      socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        setSocketState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
          error: reason
        }));

        // Clear online users when disconnected
        setOnlineUsers({ users: new Map(), count: 0 });
        setTypingState({ typingUsers: new Map(), isTyping: new Map() });

        // Attempt reconnection if enabled and not a manual disconnect
        if (reconnect && reason !== 'io client disconnect') {
          attemptReconnection();
        }
      });

      socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        setSocketState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
          error: error.message,
          reconnectAttempts: prev.reconnectAttempts + 1
        }));

        if (reconnect && socketState.reconnectAttempts < maxReconnectAttempts) {
          attemptReconnection();
        }
      });

      // Message events
      socket.on(SOCKET_EVENTS.MESSAGE_NEW, (message: IMessage) => {
        eventHandlers.onMessage?.(message);
      });

      socket.on(SOCKET_EVENTS.MESSAGE_UPDATED, (message: IMessage) => {
        eventHandlers.onMessageUpdate?.(message);
      });

      socket.on(SOCKET_EVENTS.MESSAGE_DELETED, ({ messageId, chatId }) => {
        eventHandlers.onMessageDelete?.(messageId, chatId);
      });

      // Chat events
      socket.on(SOCKET_EVENTS.CHAT_UPDATED, (chat: IChat) => {
        eventHandlers.onChatUpdate?.(chat);
      });

      // User presence events
      socket.on(SOCKET_EVENTS.USER_ONLINE, (user: AuthUser) => {
        setOnlineUsers(prev => {
          const newUsers = new Map(prev.users);
          newUsers.set(user._id, user);
          return {
            users: newUsers,
            count: newUsers.size
          };
        });
        eventHandlers.onUserOnline?.(user);
      });

      socket.on('user:offline', (userId: string) => {
        setOnlineUsers(prev => {
          const newUsers = new Map(prev.users);
          newUsers.delete(userId);
          return {
            users: newUsers,
            count: newUsers.size
          };
        });
        eventHandlers.onUserOffline?.(userId);
      });

      // Typing events
      socket.on(SOCKET_EVENTS.CHAT_TYPING, ({ chatId, userId, user, isTyping }) => {
        setTypingState(prev => {
          const newTypingUsers = new Map(prev.typingUsers);
          
          if (!newTypingUsers.has(chatId)) {
            newTypingUsers.set(chatId, new Set());
          }

          const chatTypingUsers = newTypingUsers.get(chatId)!;
          
          if (isTyping) {
            chatTypingUsers.add(userId);
            eventHandlers.onTypingStart?.(chatId, userId, user);
          } else {
            chatTypingUsers.delete(userId);
            eventHandlers.onTypingStop?.(chatId, userId);
          }

          return {
            ...prev,
            typingUsers: newTypingUsers
          };
        });
      });

      // Call events
      socket.on(SOCKET_EVENTS.CALL_INCOMING, (call) => {
        setCallState(prev => ({ ...prev, incomingCall: call }));
        eventHandlers.onCallIncoming?.(call);
      });

      socket.on(SOCKET_EVENTS.CALL_UPDATE, (call) => {
        setCallState(prev => ({ ...prev, activeCall: call }));
        eventHandlers.onCallUpdate?.(call);
      });

      socket.on(SOCKET_EVENTS.CALL_ENDED, (call) => {
        setCallState({
          activeCall: null,
          incomingCall: null,
          isInCall: false,
          isMuted: false,
          isVideoOn: false,
          participants: []
        });
        eventHandlers.onCallEnd?.(call);
      });

      // Status events
      socket.on(SOCKET_EVENTS.STATUS_NEW, (status) => {
        eventHandlers.onStatusUpdate?.(status);
      });

      // Notification events
      socket.on(SOCKET_EVENTS.NOTIFICATION_NEW, (notification) => {
        eventHandlers.onNotification?.(notification);
        toast.success(notification.title || 'New notification');
      });

      // Error events
      socket.on(SOCKET_EVENTS.SYSTEM_ERROR, (error) => {
        console.error('Socket system error:', error);
        eventHandlers.onError?.(error.message);
        toast.error(error.message || 'System error occurred');
      });

    } catch (error: any) {
      console.error('Socket connection failed:', error);
      setSocketState(prev => ({
        ...prev,
        isConnecting: false,
        error: error.message
      }));
    }
  }, [
    authState.isAuthenticated,
    authState.sessionId,
    socketState.isConnecting,
    reconnect,
    timeout,
    eventHandlers,
    socketState.reconnectAttempts,
    maxReconnectAttempts
  ]);

  // Attempt reconnection
  const attemptReconnection = useCallback(() => {
    if (socketState.reconnectAttempts >= maxReconnectAttempts) {
      console.log('Max reconnection attempts reached');
      return;
    }

    setSocketState(prev => ({ ...prev, isReconnecting: true }));

    reconnectTimerRef.current = setTimeout(() => {
      console.log(`Reconnection attempt ${socketState.reconnectAttempts + 1}/${maxReconnectAttempts}`);
      connect();
    }, reconnectDelay * Math.pow(2, socketState.reconnectAttempts)); // Exponential backoff
  }, [socketState.reconnectAttempts, maxReconnectAttempts, reconnectDelay, connect]);

  // Disconnect socket
  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setSocketState({
      isConnected: false,
      isConnecting: false,
      isReconnecting: false,
      error: null,
      lastConnectedAt: null,
      reconnectAttempts: 0
    });

    setOnlineUsers({ users: new Map(), count: 0 });
    setTypingState({ typingUsers: new Map(), isTyping: new Map() });
  }, []);

  // Send message
  const sendMessage = useCallback((messageData: any) => {
    if (!socketRef.current?.connected) {
      toast.error('Not connected to chat server');
      return false;
    }

    socketRef.current.emit(SOCKET_EVENTS.MESSAGE_SEND, messageData);
    return true;
  }, []);

  // Join chat room
  const joinChat = useCallback((chatId: string) => {
    if (!socketRef.current?.connected) return false;
    
    socketRef.current.emit(SOCKET_EVENTS.CHAT_JOIN, { chatId });
    return true;
  }, []);

  // Leave chat room
  const leaveChat = useCallback((chatId: string) => {
    if (!socketRef.current?.connected) return false;
    
    socketRef.current.emit(SOCKET_EVENTS.CHAT_LEAVE, { chatId });
    return true;
  }, []);

  // Send typing indicator
  const sendTyping = useCallback((chatId: string, isTyping: boolean) => {
    if (!socketRef.current?.connected) return false;

    // Clear existing timer for this chat
    const existingTimer = typingTimersRef.current.get(chatId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    socketRef.current.emit(SOCKET_EVENTS.CHAT_TYPING, { chatId, isTyping });

    setTypingState(prev => ({
      ...prev,
      isTyping: new Map(prev.isTyping).set(chatId, isTyping)
    }));

    if (isTyping) {
      // Auto-stop typing after 3 seconds
      const timer = setTimeout(() => {
        sendTyping(chatId, false);
      }, 3000);
      
      typingTimersRef.current.set(chatId, timer);
    } else {
      typingTimersRef.current.delete(chatId);
    }

    return true;
  }, []);

  // Update user presence
  const updatePresence = useCallback((status: 'online' | 'away' | 'busy' | 'offline') => {
    if (!socketRef.current?.connected) return false;
    
    socketRef.current.emit(SOCKET_EVENTS.USER_UPDATE_PRESENCE, { isOnline: status === 'online' });
    return true;
  }, []);

  // Mark message as read
  const markMessageRead = useCallback((messageId: string, chatId: string) => {
    if (!socketRef.current?.connected) return false;
    
    socketRef.current.emit(SOCKET_EVENTS.MESSAGE_READ, { messageId, chatId });
    return true;
  }, []);

  // Initiate call
  const initiateCall = useCallback((callData: any) => {
    if (!socketRef.current?.connected) return false;
    
    socketRef.current.emit(SOCKET_EVENTS.CALL_INITIATE, callData);
    return true;
  }, []);

  // Accept call
  const acceptCall = useCallback((callId: string) => {
    if (!socketRef.current?.connected) return false;
    
    socketRef.current.emit(SOCKET_EVENTS.CALL_ACCEPTED, { callId });
    setCallState(prev => ({ ...prev, incomingCall: null, isInCall: true }));
    return true;
  }, []);

  // Decline call
  const declineCall = useCallback((callId: string) => {
    if (!socketRef.current?.connected) return false;
    
    socketRef.current.emit(SOCKET_EVENTS.CALL_DECLINED, { callId });
    setCallState(prev => ({ ...prev, incomingCall: null }));
    return true;
  }, []);

  // End call
  const endCall = useCallback((callId: string) => {
    if (!socketRef.current?.connected) return false;
    
    socketRef.current.emit(SOCKET_EVENTS.CALL_ENDED, { callId });
    setCallState({
      activeCall: null,
      incomingCall: null,
      isInCall: false,
      isMuted: false,
      isVideoOn: false,
      participants: []
    });
    return true;
  }, []);

  // Generic emit function
  const emit = useCallback(<T>(event: string, data: T) => {
    if (!socketRef.current?.connected) return false;
    
    socketRef.current.emit(event as any, data);
    return true;
  }, []);

  // Auto-connect when authenticated
  useEffect(() => {
    if (autoConnect && authState.isAuthenticated && !socketState.isConnected && !socketState.isConnecting) {
      connect();
    }
  }, [autoConnect, authState.isAuthenticated, socketState.isConnected, socketState.isConnecting, connect]);

  // Disconnect when unauthenticated
  useEffect(() => {
    if (!authState.isAuthenticated && (socketState.isConnected || socketState.isConnecting)) {
      disconnect();
    }
  }, [authState.isAuthenticated, socketState.isConnected, socketState.isConnecting, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear all timers
      typingTimersRef.current.forEach(timer => clearTimeout(timer));
      typingTimersRef.current.clear();
      
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      
      disconnect();
    };
  }, [disconnect]);

  // Helper functions
  const isUserOnline = useCallback((userId: string): boolean => {
    return onlineUsers.users.has(userId);
  }, [onlineUsers.users]);

  const getTypingUsers = useCallback((chatId: string): string[] => {
    const typingSet = typingState.typingUsers.get(chatId);
    return typingSet ? Array.from(typingSet) : [];
  }, [typingState.typingUsers]);

  const isTypingInChat = useCallback((chatId: string): boolean => {
    return typingState.isTyping.get(chatId) || false;
  }, [typingState.isTyping]);

  return {
    // State
    socket: socketRef.current,
    socketState,
    onlineUsers,
    typingState,
    callState,

    // Connection methods
    connect,
    disconnect,
    
    // Chat methods
    sendMessage,
    joinChat,
    leaveChat,
    sendTyping,
    markMessageRead,
    
    // Presence methods
    updatePresence,
    
    // Call methods
    initiateCall,
    acceptCall,
    declineCall,
    endCall,
    
    // Utility methods
    emit,
    isUserOnline,
    getTypingUsers,
    isTypingInChat
  };
}