import { IMedia, UserResponse } from "./api";

export interface IMessage {
  _id: string;
  chatId: string;
  senderId: string;
  type: MessageType;
  content: string;
  mediaId?: string;
  location?: LocationData;
  contact?: ContactData;
  replyTo?: string;
  isForwarded: boolean;
  forwardedFrom?: string;
  forwardedTimes: number;
  reactions: MessageReaction[];
  mentions: string[];
  status: MessageStatus;
  readBy: ReadReceipt[];
  deliveredTo: DeliveryReceipt[];
  isEdited: boolean;
  editedAt?: Date;
  editHistory: EditHistory[];
  isDeleted: boolean;
  deletedAt?: Date;
  deletedFor: string[];
  isStarred: boolean;
  starredBy: string[];
  encryptedContent?: string;
  disappearsAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  address?: string;
}

export interface ContactData {
  name: string;
  phoneNumber: string;
  avatar?: string;
}

export interface MessageReaction {
  userId: string;
  emoji: string;
  createdAt: Date;
}

export interface ReadReceipt {
  userId: string;
  readAt: Date;
}

export interface DeliveryReceipt {
  userId: string;
  deliveredAt: Date;
}

export interface EditHistory {
  content: string;
  editedAt: Date;
}

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'voice' | 'location' | 'contact' | 'sticker' | 'gif';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface MessageCreateRequest {
  chatId: string;
  type: MessageType;
  content: string;
  mediaId?: string;
  location?: LocationData;
  contact?: ContactData;
  replyTo?: string;
  mentions?: string[];
}

export interface MessageUpdateRequest {
  content?: string;
  reactions?: MessageReaction[];
}

export interface MessageResponse {
  message: IMessage;
  sender?: UserResponse;
  replyToMessage?: IMessage;
  mediaDetails?: IMedia;
}

export interface MessageListResponse {
  messages: MessageResponse[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}