import { z } from 'zod';
import { REGEX_PATTERNS, DEFAULTS } from '@/lib/utils/constants';

// Base schemas for reusability
const notificationDataSchema = z.object({
  chatId: z.string().min(1, 'Chat ID required').optional(),
  messageId: z.string().min(1, 'Message ID required').optional(),
  callId: z.string().min(1, 'Call ID required').optional(),
  groupId: z.string().min(1, 'Group ID required').optional(),
  statusId: z.string().min(1, 'Status ID required').optional(),
  senderId: z.string().min(1, 'Sender ID required').optional(),
  action: z.string().max(50, 'Action too long').optional()
}).catchall(z.any()); // Allow additional fields

const platformDeliverySchema = z.object({
  platform: z.enum(['ios', 'android', 'web'], {
    errorMap: () => ({ message: 'Platform must be ios, android, or web' })
  }),
  deviceTokens: z.array(z.string().min(1, 'Device token required'))
    .min(1, 'At least one device token required')
    .max(1000, 'Too many device tokens'),
  status: z.enum(['pending', 'sent', 'delivered', 'failed'])
    .default('pending'),
  sentAt: z.date().optional(),
  deliveredAt: z.date().optional(),
  failureReason: z.string().max(500, 'Failure reason too long').optional(),
  retryCount: z.number().int().min(0).default(0),
  lastRetryAt: z.date().optional(),
  messageId: z.string().max(100, 'Message ID too long').optional()
});

const iosSettingsSchema = z.object({
  category: z.string().max(50, 'Category too long').optional(),
  threadId: z.string().max(100, 'Thread ID too long').optional(),
  subtitle: z.string().max(100, 'Subtitle too long').optional(),
  sound: z.string().max(50, 'Sound name too long').optional(),
  badge: z.number().int().min(0).max(99999).optional(),
  mutableContent: z.boolean().default(false),
  contentAvailable: z.boolean().default(false),
  interruptionLevel: z.enum(['passive', 'active', 'timeSensitive', 'critical'])
    .default('active'),
  relevanceScore: z.number().min(0).max(1).optional()
});

const androidSettingsSchema = z.object({
  channelId: z.string().max(50, 'Channel ID too long').optional(),
  tag: z.string().max(50, 'Tag too long').optional(),
  group: z.string().max(50, 'Group too long').optional(),
  groupSummary: z.boolean().default(false),
  color: z.string().regex(REGEX_PATTERNS.HEX_COLOR, 'Invalid color format').optional(),
  icon: z.string().max(100, 'Icon name too long').optional(),
  largeIcon: z.string().max(200, 'Large icon URL too long').optional(),
  bigText: z.string().max(1000, 'Big text too long').optional(),
  bigPicture: z.string().max(200, 'Big picture URL too long').optional(),
  vibrationPattern: z.array(z.number().int().min(0)).max(10).optional(),
  lights: z.object({
    color: z.string().regex(REGEX_PATTERNS.HEX_COLOR, 'Invalid light color'),
    onMs: z.number().int().min(0).max(10000),
    offMs: z.number().int().min(0).max(10000)
  }).optional(),
  sticky: z.boolean().default(false),
  localOnly: z.boolean().default(false),
  ongoing: z.boolean().default(false),
  autoCancel: z.boolean().default(true),
  timeoutAfter: z.number().int().min(0).optional(),
  showWhen: z.boolean().default(true),
  when: z.date().optional(),
  usesChronometer: z.boolean().default(false),
  chronometerCountDown: z.boolean().default(false)
});

const webSettingsSchema = z.object({
  icon: z.string().max(200, 'Icon URL too long').optional(),
  image: z.string().max(200, 'Image URL too long').optional(),
  badge: z.string().max(200, 'Badge URL too long').optional(),
  tag: z.string().max(50, 'Tag too long').optional(),
  requireInteraction: z.boolean().default(false),
  silent: z.boolean().default(false),
  timestamp: z.number().int().min(0).optional(),
  vibrate: z.array(z.number().int().min(0)).max(10).optional(),
  actions: z.array(z.object({
    action: z.string().min(1, 'Action required').max(50, 'Action too long'),
    title: z.string().min(1, 'Action title required').max(100, 'Action title too long'),
    icon: z.string().max(200, 'Action icon URL too long').optional()
  })).max(5, 'Too many actions').optional(),
  dir: z.enum(['auto', 'ltr', 'rtl']).default('auto'),
  lang: z.string().max(10, 'Language code too long').optional(),
  clickAction: z.string().max(200, 'Click action URL too long').optional()
});

const retryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryInterval: z.number().int().min(60).max(86400).default(300), // 1 minute to 1 day
  backoffMultiplier: z.number().min(1).max(10).default(2)
});

const trackingSchema = z.object({
  sent: z.number().int().min(0).default(0),
  delivered: z.number().int().min(0).default(0),
  failed: z.number().int().min(0).default(0),
  clicked: z.number().int().min(0).default(0),
  dismissed: z.number().int().min(0).default(0),
  lastInteraction: z.date().optional()
});

const metadataSchema = z.object({
  source: z.string().max(50, 'Source too long').optional(),
  campaign: z.string().max(50, 'Campaign ID too long').optional(),
  experiment: z.string().max(50, 'Experiment ID too long').optional(),
  version: z.string().max(20, 'Version too long').optional()
}).catchall(z.any()); // Allow additional metadata fields

// Main validation schemas
export const notificationCreateSchema = z.object({
  userId: z.string().min(1, 'User ID required'),
  type: z.enum(['message', 'call', 'group_invite', 'status_view', 'system', 'broadcast', 'mention', 'reminder'], {
    errorMap: () => ({ message: 'Invalid notification type' })
  }),
  title: z.string().min(1, 'Title required').max(100, 'Title too long'),
  body: z.string().min(1, 'Body required').max(500, 'Body too long'),
  data: notificationDataSchema.optional(),
  
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  sound: z.string().max(50, 'Sound name too long').optional(),
  badge: z.number().int().min(0).max(99999).optional(),
  icon: z.string().max(200, 'Icon URL too long').optional(),
  image: z.string().max(200, 'Image URL too long').optional(),
  color: z.string().regex(REGEX_PATTERNS.HEX_COLOR, 'Invalid color format').optional(),
  
  ios: iosSettingsSchema.optional(),
  android: androidSettingsSchema.optional(),
  web: webSettingsSchema.optional(),
  
  scheduledFor: z.date().min(new Date(), 'Scheduled time must be in the future').optional(),
  expiresAt: z.date().min(new Date(), 'Expiry time must be in the future').optional(),
  timeToLive: z.number().int().min(60).max(2419200).optional(), // 1 minute to 28 days
  
  retryPolicy: retryPolicySchema.optional(),
  
  group: z.string().max(50, 'Group name too long').optional(),
  thread: z.string().max(50, 'Thread name too long').optional(),
  collapseKey: z.string().max(50, 'Collapse key too long').optional(),
  
  metadata: metadataSchema.optional()
}).refine((data) => {
  // Validate expiry is after scheduled time
  if (data.scheduledFor && data.expiresAt && data.scheduledFor >= data.expiresAt) {
    return false;
  }
  return true;
}, {
  message: 'Expiry time must be after scheduled time',
  path: ['expiresAt']
});

export const notificationUpdateSchema = z.object({
  isRead: z.boolean().optional(),
  deliveryStatus: z.enum(['pending', 'sent', 'delivered', 'failed', 'scheduled']).optional(),
  platformDelivery: z.array(platformDeliverySchema).optional(),
  tracking: trackingSchema.partial().optional(),
  
  scheduledFor: z.date().min(new Date(), 'Scheduled time must be in the future').optional(),
  expiresAt: z.date().min(new Date(), 'Expiry time must be in the future').optional(),
  
  metadata: metadataSchema.optional()
});

export const bulkNotificationCreateSchema = z.object({
  notifications: z.array(notificationCreateSchema)
    .min(1, 'At least one notification required')
    .max(1000, 'Too many notifications for bulk operation'),
  defaultSettings: z.object({
    priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
    sound: z.string().max(50, 'Sound name too long').optional(),
    retryPolicy: retryPolicySchema.optional(),
    expiresAt: z.date().min(new Date(), 'Expiry time must be in the future').optional()
  }).optional()
});

export const notificationSearchSchema = z.object({
  userId: z.string().min(1, 'User ID required').optional(),
  type: z.enum(['message', 'call', 'group_invite', 'status_view', 'system', 'broadcast', 'mention', 'reminder']).optional(),
  deliveryStatus: z.enum(['pending', 'sent', 'delivered', 'failed', 'scheduled']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  isRead: z.boolean().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
  group: z.string().max(50, 'Group name too long').optional(),
  thread: z.string().max(50, 'Thread name too long').optional(),
  campaign: z.string().max(50, 'Campaign ID too long').optional(),
  page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit cannot exceed 100').default(DEFAULTS.PAGINATION_LIMIT),
  sortBy: z.enum(['createdAt', 'priority', 'deliveryStatus']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
}).refine((data) => {
  // Validate date range
  if (data.dateFrom && data.dateTo && data.dateFrom > data.dateTo) {
    return false;
  }
  return true;
}, {
  message: 'Date from must be before date to',
  path: ['dateFrom']
});

// Template validation schemas
export const notificationTemplateSchema = z.object({
  name: z.string().min(1, 'Template name required').max(100, 'Template name too long'),
  type: z.enum(['message', 'call', 'group_invite', 'status_view', 'system', 'broadcast', 'mention', 'reminder']),
  title: z.string().min(1, 'Title required').max(100, 'Title too long'),
  body: z.string().min(1, 'Body required').max(500, 'Body too long'),
  variables: z.array(z.string().max(50, 'Variable name too long')).max(20, 'Too many variables'),
  
  ios: iosSettingsSchema.optional(),
  android: androidSettingsSchema.optional(),
  web: webSettingsSchema.optional(),
  
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  isActive: z.boolean().default(true)
});

export const templateVariablesSchema = z.record(
  z.string().max(50, 'Variable name too long'),
  z.union([
    z.string().max(500, 'Variable value too long'),
    z.number(),
    z.boolean()
  ])
).refine((data) => {
  // Limit number of variables
  return Object.keys(data).length <= 20;
}, {
  message: 'Too many template variables'
});

// Push notification payload validation
export const pushNotificationPayloadSchema = z.object({
  title: z.string().min(1, 'Title required').max(100, 'Title too long'),
  body: z.string().min(1, 'Body required').max(500, 'Body too long'),
  data: z.record(z.any()).optional(),
  badge: z.number().int().min(0).max(99999).optional(),
  sound: z.string().max(50, 'Sound name too long').optional(),
  icon: z.string().max(200, 'Icon URL too long').optional(),
  image: z.string().max(200, 'Image URL too long').optional(),
  clickAction: z.string().max(200, 'Click action URL too long').optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  timeToLive: z.number().int().min(60).max(2419200).optional(),
  collapseKey: z.string().max(50, 'Collapse key too long').optional()
});

// Subscription validation
export const notificationSubscriptionSchema = z.object({
  userId: z.string().min(1, 'User ID required'),
  platform: z.enum(['ios', 'android', 'web']),
  deviceToken: z.string().min(1, 'Device token required').max(500, 'Device token too long'),
  endpoint: z.string().url('Invalid endpoint URL').optional(),
  keys: z.object({
    p256dh: z.string().min(1, 'P256DH key required'),
    auth: z.string().min(1, 'Auth key required')
  }).optional(),
  userAgent: z.string().max(500, 'User agent too long').optional(),
  isActive: z.boolean().default(true)
}).refine((data) => {
  // Web push requires endpoint and keys
  if (data.platform === 'web') {
    return data.endpoint && data.keys;
  }
  return true;
}, {
  message: 'Web push notifications require endpoint and keys',
  path: ['endpoint']
});

// Scheduled notification validation
export const scheduledNotificationSchema = z.object({
  notificationId: z.string().min(1, 'Notification ID required'),
  userId: z.string().min(1, 'User ID required'),
  scheduledFor: z.date().min(new Date(), 'Scheduled time must be in the future'),
  timezone: z.string().max(50, 'Timezone too long').optional(),
  recurring: z.object({
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(100),
    endDate: z.date().min(new Date(), 'End date must be in the future').optional(),
    maxOccurrences: z.number().int().min(1).max(1000).optional()
  }).optional(),
  isActive: z.boolean().default(true)
}).refine((data) => {
  // If recurring, validate end date or max occurrences
  if (data.recurring && !data.recurring.endDate && !data.recurring.maxOccurrences) {
    return false;
  }
  return true;
}, {
  message: 'Recurring notifications must have either end date or max occurrences',
  path: ['recurring']
});

// Analytics validation
export const notificationAnalyticsSchema = z.object({
  notificationId: z.string().min(1, 'Notification ID required'),
  userId: z.string().min(1, 'User ID required'),
  action: z.enum(['sent', 'delivered', 'opened', 'clicked', 'dismissed']),
  platform: z.enum(['ios', 'android', 'web']),
  timestamp: z.date().default(() => new Date()),
  metadata: z.record(z.any()).optional()
});

// Export validation functions
export function validateNotificationCreate(data: unknown) {
  return notificationCreateSchema.parse(data);
}

export function validateNotificationUpdate(data: unknown) {
  return notificationUpdateSchema.parse(data);
}

export function validateBulkNotificationCreate(data: unknown) {
  return bulkNotificationCreateSchema.parse(data);
}

export function validateNotificationSearch(data: unknown) {
  return notificationSearchSchema.parse(data);
}

export function validateNotificationTemplate(data: unknown) {
  return notificationTemplateSchema.parse(data);
}

export function validateTemplateVariables(data: unknown) {
  return templateVariablesSchema.parse(data);
}

export function validatePushNotificationPayload(data: unknown) {
  return pushNotificationPayloadSchema.parse(data);
}

export function validateNotificationSubscription(data: unknown) {
  return notificationSubscriptionSchema.parse(data);
}

export function validateScheduledNotification(data: unknown) {
  return scheduledNotificationSchema.parse(data);
}

export function validateNotificationAnalytics(data: unknown) {
  return notificationAnalyticsSchema.parse(data);
}