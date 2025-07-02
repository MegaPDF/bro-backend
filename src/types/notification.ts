export interface INotification {
  _id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: NotificationData;
  isRead: boolean;
  readAt?: Date;
  isSent: boolean;
  sentAt?: Date;
  deliveryStatus: NotificationDeliveryStatus;
  deviceTokens: string[];
  priority: NotificationPriority;
  sound?: string;
  badge?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationData {
  chatId?: string;
  messageId?: string;
  callId?: string;
  groupId?: string;
  statusId?: string;
  senderId?: string;
  action?: string;
  [key: string]: any;
}

export type NotificationType = 'message' | 'call' | 'group_invite' | 'status_view' | 'system' | 'broadcast';
export type NotificationDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed';
export type NotificationPriority = 'low' | 'normal' | 'high';

export interface NotificationCreateRequest {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: NotificationData;
  priority?: NotificationPriority;
  sound?: string;
}

export interface NotificationResponse {
  notification: INotification;
}

export interface NotificationListResponse {
  notifications: NotificationResponse[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
}
