import { IMessage, UserResponse } from "./api";

export interface IChat {
  _id: string;
  type: ChatType;
  participants: string[];
  groupInfo?: GroupInfo;
  lastMessage?: string;
  lastMessageTime: Date;
  unreadCount: UnreadCount[];
  isPinned: PinnedInfo[];
  isArchived: ArchivedInfo[];
  isMuted: MutedInfo[];
  disappearingMessages: DisappearingMessageSettings;
  encryptionKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupInfo {
  name: string;
  description: string;
  avatar: string;
  admins: string[];
  creator: string;
  inviteLink: string;
  settings: GroupSettings;
}

export interface GroupSettings {
  onlyAdminsCanMessage: boolean;
  onlyAdminsCanEditGroupInfo: boolean;
  approvalRequired: boolean;
}

export interface UnreadCount {
  userId: string;
  count: number;
}

export interface PinnedInfo {
  userId: string;
  pinnedAt: Date;
}

export interface ArchivedInfo {
  userId: string;
  archivedAt: Date;
}

export interface MutedInfo {
  userId: string;
  mutedUntil: Date;
}

export interface DisappearingMessageSettings {
  enabled: boolean;
  duration: number;
  enabledBy: string;
  enabledAt: Date;
}

export type ChatType = 'individual' | 'group';

export interface ChatCreateRequest {
  type: ChatType;
  participants: string[];
  groupInfo?: Partial<GroupInfo>;
}

export interface ChatUpdateRequest {
  groupInfo?: Partial<GroupInfo>;
  disappearingMessages?: Partial<DisappearingMessageSettings>;
}

export interface ChatResponse {
  chat: IChat;
  lastMessage?: IMessage;
  unreadCount: number;
  participantDetails?: UserResponse[];
}

export interface ChatListResponse {
  chats: ChatResponse[];
  total: number;
  page: number;
  limit: number;
}