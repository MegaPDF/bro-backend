import { CallEndReason, CallEndRequest, CallInitiateRequest, CallParticipant, CallResponse, ChatResponse, MessageCreateRequest, MessageReaction, MessageResponse, MessageUpdateRequest, NotificationResponse, StatusResponse, StatusViewer, UserResponse, UserStatus } from "./api";

export interface ServerToClientEvents {
  // Message Events
  'message:new': (data: MessageResponse) => void;
  'message:updated': (data: MessageResponse) => void;
  'message:deleted': (data: { messageId: string; chatId: string }) => void;
  'message:reaction': (data: { messageId: string; reaction: MessageReaction }) => void;
  'message:read': (data: { messageId: string; userId: string; readAt: Date }) => void;
  'message:delivered': (data: { messageId: string; userId: string; deliveredAt: Date }) => void;
  
  // Chat Events
  'chat:typing': (data: { chatId: string; userId: string; isTyping: boolean }) => void;
  'chat:updated': (data: ChatResponse) => void;
  'chat:member_added': (data: { chatId: string; members: string[] }) => void;
  'chat:member_removed': (data: { chatId: string; members: string[] }) => void;
  
  // User Events
  'user:online': (data: { userId: string; isOnline: boolean; lastSeen: Date }) => void;
  'user:status_updated': (data: { userId: string; status: UserStatus }) => void;
  'user:profile_updated': (data: UserResponse) => void;
  
  // Call Events
  'call:incoming': (data: CallResponse) => void;
  'call:accepted': (data: { callId: string; userId: string }) => void;
  'call:declined': (data: { callId: string; userId: string }) => void;
  'call:ended': (data: { callId: string; endReason: CallEndReason }) => void;
  'call:participant_joined': (data: { callId: string; participant: CallParticipant }) => void;
  'call:participant_left': (data: { callId: string; userId: string }) => void;
  
  // Status Events
  'status:new': (data: StatusResponse) => void;
  'status:viewed': (data: { statusId: string; viewer: StatusViewer }) => void;
  
  // Notification Events
  'notification:new': (data: NotificationResponse) => void;
  
  // System Events
  'system:error': (data: { error: string; code?: string }) => void;
  'system:maintenance': (data: { message: string; scheduledAt?: Date }) => void;
}

export interface ClientToServerEvents {
  // Authentication
  'auth:login': (data: { token: string }) => void;
  'auth:logout': () => void;
  
  // Message Events
  'message:send': (data: MessageCreateRequest) => void;
  'message:edit': (data: { messageId: string } & MessageUpdateRequest) => void;
  'message:delete': (data: { messageId: string; deleteForEveryone: boolean }) => void;
  'message:react': (data: { messageId: string; emoji: string }) => void;
  'message:read': (data: { messageId: string; chatId: string }) => void;
  
  // Chat Events
  'chat:typing': (data: { chatId: string; isTyping: boolean }) => void;
  'chat:join': (data: { chatId: string }) => void;
  'chat:leave': (data: { chatId: string }) => void;
  
  // Call Events
  'call:initiate': (data: CallInitiateRequest) => void;
  'call:accept': (data: { callId: string }) => void;
  'call:decline': (data: { callId: string }) => void;
  'call:end': (data: CallEndRequest) => void;
  'call:webrtc_signal': (data: { callId: string; signal: any; targetUserId: string }) => void;
  
  // Status Events
  'status:view': (data: { statusId: string }) => void;
  
  // User Events
  'user:update_presence': (data: { isOnline: boolean }) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId: string;
  deviceId: string;
  isAuthenticated: boolean;
  joinedRooms: string[];
}
