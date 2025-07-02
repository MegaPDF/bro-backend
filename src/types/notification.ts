export interface INotification {
  _id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: NotificationData;
  
  // Basic notification state
  isRead: boolean;
  readAt?: Date;
  isSent: boolean;
  sentAt?: Date;
  deliveryStatus: NotificationDeliveryStatus;
  
  // Platform-specific delivery tracking
  platformDelivery: PlatformDelivery[];
  
  // Notification content and appearance
  priority: NotificationPriority;
  sound?: string;
  badge?: number;
  icon?: string;
  image?: string;
  color?: string;
  
  // Platform-specific settings
  ios: IOSNotificationSettings;
  android: AndroidNotificationSettings;
  web: WebNotificationSettings;
  
  // Scheduling and expiry
  scheduledFor?: Date;
  expiresAt?: Date;
  timeToLive?: number;
  
  // Retry mechanism
  retryPolicy: RetryPolicy;
  
  // Analytics and tracking
  tracking: NotificationTracking;
  
  // Grouping and categorization
  group?: string;
  thread?: string;
  collapseKey?: string;
  
  // Metadata
  metadata: NotificationMetadata;
  
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

export interface PlatformDelivery {
  platform: 'ios' | 'android' | 'web';
  deviceTokens: string[];
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  sentAt?: Date;
  deliveredAt?: Date;
  failureReason?: string;
  retryCount: number;
  lastRetryAt?: Date;
  messageId?: string; // FCM/APNS message ID
}

export interface IOSNotificationSettings {
  category?: string;
  threadId?: string;
  subtitle?: string;
  sound?: string;
  badge?: number;
  mutableContent?: boolean;
  contentAvailable?: boolean;
  interruptionLevel?: 'passive' | 'active' | 'timeSensitive' | 'critical';
  relevanceScore?: number;
}

export interface AndroidNotificationSettings {
  channelId?: string;
  tag?: string;
  group?: string;
  groupSummary?: boolean;
  color?: string;
  icon?: string;
  largeIcon?: string;
  bigText?: string;
  bigPicture?: string;
  vibrationPattern?: number[];
  lights?: {
    color: string;
    onMs: number;
    offMs: number;
  };
  sticky?: boolean;
  localOnly?: boolean;
  ongoing?: boolean;
  autoCancel?: boolean;
  timeoutAfter?: number;
  showWhen?: boolean;
  when?: Date;
  usesChronometer?: boolean;
  chronometerCountDown?: boolean;
}

export interface WebNotificationSettings {
  icon?: string;
  image?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  silent?: boolean;
  timestamp?: number;
  vibrate?: number[];
  actions?: NotificationAction[];
  dir?: 'auto' | 'ltr' | 'rtl';
  lang?: string;
  clickAction?: string;
}

export interface NotificationAction {
  action: string;
  title: string;
  icon?: string;
}

export interface RetryPolicy {
  maxRetries: number;
  retryInterval: number; // seconds
  backoffMultiplier: number;
}

export interface NotificationTracking {
  sent: number;
  delivered: number;
  failed: number;
  clicked: number;
  dismissed: number;
  lastInteraction?: Date;
}

export interface NotificationMetadata {
  source?: string;
  campaign?: string;
  experiment?: string;
  version?: string;
  [key: string]: any;
}

export type NotificationType = 
  | 'message' 
  | 'call' 
  | 'group_invite' 
  | 'status_view' 
  | 'system' 
  | 'broadcast' 
  | 'mention' 
  | 'reminder';

export type NotificationDeliveryStatus = 
  | 'pending' 
  | 'sent' 
  | 'delivered' 
  | 'failed' 
  | 'scheduled';

export type NotificationPriority = 
  | 'low' 
  | 'normal' 
  | 'high' 
  | 'critical';

// Request/Response interfaces
export interface NotificationCreateRequest {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: NotificationData;
  priority?: NotificationPriority;
  sound?: string;
  badge?: number;
  icon?: string;
  image?: string;
  scheduledFor?: Date;
  expiresAt?: Date;
  timeToLive?: number;
  ios?: Partial<IOSNotificationSettings>;
  android?: Partial<AndroidNotificationSettings>;
  web?: Partial<WebNotificationSettings>;
  retryPolicy?: Partial<RetryPolicy>;
  metadata?: NotificationMetadata;
}

export interface BulkNotificationCreateRequest {
  notifications: NotificationCreateRequest[];
  defaultSettings?: {
    priority?: NotificationPriority;
    sound?: string;
    retryPolicy?: Partial<RetryPolicy>;
    expiresAt?: Date;
  };
}

export interface NotificationUpdateRequest {
  isRead?: boolean;
  deliveryStatus?: NotificationDeliveryStatus;
  platformDelivery?: Partial<PlatformDelivery>[];
  tracking?: Partial<NotificationTracking>;
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

export interface NotificationStatsResponse {
  total: number;
  unread: number;
  byType: Record<NotificationType, number>;
  byStatus: Record<NotificationDeliveryStatus, number>;
  byPriority: Record<NotificationPriority, number>;
  deliveryRate: number;
  clickRate: number;
  recentActivity: {
    sent: number;
    delivered: number;
    failed: number;
    clicked: number;
  };
}

export interface NotificationSearchRequest {
  userId?: string;
  type?: NotificationType;
  deliveryStatus?: NotificationDeliveryStatus;
  priority?: NotificationPriority;
  isRead?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
  platform?: 'ios' | 'android' | 'web';
  group?: string;
  thread?: string;
  campaign?: string;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'priority' | 'deliveryStatus';
  sortOrder?: 'asc' | 'desc';
}

// Push notification service interfaces
export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  badge?: number;
  sound?: string;
  icon?: string;
  image?: string;
  clickAction?: string;
  priority?: 'low' | 'normal' | 'high';
  timeToLive?: number;
  collapseKey?: string;
}

export interface PushNotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
  platform: 'ios' | 'android' | 'web';
  deviceToken: string;
}

export interface BatchPushResult {
  successful: PushNotificationResult[];
  failed: PushNotificationResult[];
  totalSent: number;
  successCount: number;
  failureCount: number;
}

// Template interfaces for notification content
export interface NotificationTemplate {
  id: string;
  name: string;
  type: NotificationType;
  title: string;
  body: string;
  variables: string[]; // Template variables like {{userName}}, {{groupName}}
  ios?: Partial<IOSNotificationSettings>;
  android?: Partial<AndroidNotificationSettings>;
  web?: Partial<WebNotificationSettings>;
  priority: NotificationPriority;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationTemplateVariables {
  [key: string]: string | number | boolean;
}

// Scheduled notification interfaces
export interface ScheduledNotification {
  id: string;
  notificationId: string;
  userId: string;
  scheduledFor: Date;
  timezone?: string;
  recurring?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval: number;
    endDate?: Date;
    maxOccurrences?: number;
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Notification subscription interfaces
export interface NotificationSubscription {
  userId: string;
  platform: 'ios' | 'android' | 'web';
  deviceToken: string;
  endpoint?: string; // For web push
  keys?: {
    p256dh: string;
    auth: string;
  }; // For web push
  userAgent?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Analytics interfaces
export interface NotificationAnalytics {
  notificationId: string;
  userId: string;
  action: 'sent' | 'delivered' | 'opened' | 'clicked' | 'dismissed';
  platform: 'ios' | 'android' | 'web';
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface NotificationCampaignStats {
  campaignId: string;
  totalSent: number;
  totalDelivered: number;
  totalOpened: number;
  totalClicked: number;
  totalDismissed: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  dismissalRate: number;
  byPlatform: {
    ios: NotificationCampaignStats;
    android: NotificationCampaignStats;
    web: NotificationCampaignStats;
  };
  timeline: {
    date: Date;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    dismissed: number;
  }[];
}

export default INotification;