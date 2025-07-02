import { z } from 'zod';
import { REGEX_PATTERNS, MESSAGE_TYPES, MESSAGE_STATUS } from '@/lib/utils/constants';

// Message location schema
export const messageLocationSchema = z.object({
  latitude: z.number()
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90'),
  longitude: z.number()
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180'),
  address: z.string()
    .max(200, 'Address too long')
    .optional()
});

// Message contact schema
export const messageContactSchema = z.object({
  name: z.string()
    .min(1, 'Contact name required')
    .max(100, 'Contact name too long'),
  phoneNumber: z.string()
    .regex(REGEX_PATTERNS.PHONE_NUMBER, 'Invalid phone number format'),
  avatar: z.string()
    .url('Invalid avatar URL')
    .optional()
});

// Message reaction schema
export const messageReactionSchema = z.object({
  userId: z.string()
    .min(1, 'User ID required'),
  emoji: z.string()
    .min(1, 'Emoji required')
    .max(10, 'Emoji too long'),
  createdAt: z.date()
    .default(() => new Date())
});

// Message create schema
export const messageCreateSchema = z.object({
  chatId: z.string()
    .min(1, 'Chat ID required'),
  type: z.enum([
    MESSAGE_TYPES.TEXT,
    MESSAGE_TYPES.IMAGE,
    MESSAGE_TYPES.VIDEO,
    MESSAGE_TYPES.AUDIO,
    MESSAGE_TYPES.DOCUMENT,
    MESSAGE_TYPES.VOICE,
    MESSAGE_TYPES.LOCATION,
    MESSAGE_TYPES.CONTACT,
    MESSAGE_TYPES.STICKER,
    MESSAGE_TYPES.GIF
  ] as const, {
    errorMap: () => ({ message: 'Invalid message type' })
  }),
  content: z.string()
    .min(1, 'Content is required')
    .max(4096, 'Message content too long'),
  mediaId: z.string()
    .min(1, 'Media ID required')
    .optional(),
  location: messageLocationSchema.optional(),
  contact: messageContactSchema.optional(),
  replyTo: z.string()
    .min(1, 'Reply to message ID required')
    .optional(),
  mentions: z.array(z.string().min(1, 'Mention user ID required'))
    .max(10, 'Too many mentions')
    .optional(),
  isStarred: z.boolean().default(false),
  deliveredAt: z.date().optional(),
  readAt: z.date().optional()
}).refine((data) => {
  // Validate content based on message type
  if (data.type === MESSAGE_TYPES.TEXT && !data.content.trim()) {
    return false;
  }
  if (data.type === MESSAGE_TYPES.LOCATION && !data.location) {
    return false;
  }
  if (data.type === MESSAGE_TYPES.CONTACT && !data.contact) {
    return false;
  }
  if ([
    MESSAGE_TYPES.IMAGE,
    MESSAGE_TYPES.VIDEO,
    MESSAGE_TYPES.AUDIO,
    MESSAGE_TYPES.DOCUMENT,
    MESSAGE_TYPES.VOICE,
    MESSAGE_TYPES.STICKER,
    MESSAGE_TYPES.GIF
  ].includes(data.type as any) && !data.mediaId) {
    return false;
  }
  return true;
}, {
  message: 'Invalid message content for the specified type',
  path: ['content']
});

// Message update schema
export const messageUpdateSchema = z.object({
  content: z.string()
    .min(1, 'Content required')
    .max(4096, 'Message content too long')
    .optional(),
  reactions: z.array(messageReactionSchema)
    .max(50, 'Too many reactions')
    .optional(),
  isStarred: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  deletedAt: z.date().optional()
});

// Message search schema
export const messageSearchSchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit cannot exceed 100').default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().max(100, 'Search query too long').optional(),
  filters: z.record(z.any()).optional(),
  chatId: z.string()
    .min(1, 'Chat ID required')
    .optional(),
  senderId: z.string()
    .min(1, 'Sender ID required')
    .optional(),
  type: z.enum([
    MESSAGE_TYPES.TEXT,
    MESSAGE_TYPES.IMAGE,
    MESSAGE_TYPES.VIDEO,
    MESSAGE_TYPES.AUDIO,
    MESSAGE_TYPES.DOCUMENT,
    MESSAGE_TYPES.VOICE,
    MESSAGE_TYPES.LOCATION,
    MESSAGE_TYPES.CONTACT,
    MESSAGE_TYPES.STICKER,
    MESSAGE_TYPES.GIF
  ] as const).optional(),
  status: z.enum([
    MESSAGE_STATUS.SENT,
    MESSAGE_STATUS.DELIVERED,
    MESSAGE_STATUS.READ,
    MESSAGE_STATUS.FAILED
  ] as const).optional(),
  isStarred: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional()
});

// Message bulk operations schema
export const messageBulkOperationSchema = z.object({
  messageIds: z.array(z.string().min(1, 'Message ID required'))
    .min(1, 'At least one message ID required')
    .max(50, 'Too many messages for bulk operation'),
  operation: z.enum(['delete', 'star', 'unstar', 'forward'], {
    errorMap: () => ({ message: 'Invalid bulk operation' })
  }),
  targetChatIds: z.array(z.string().min(1, 'Target chat ID required'))
    .max(10, 'Too many target chats')
    .optional() // Only required for forward operation
}).refine((data) => {
  // Forward operation requires target chats
  if (data.operation === 'forward' && (!data.targetChatIds || data.targetChatIds.length === 0)) {
    return false;
  }
  return true;
}, {
  message: 'Forward operation requires target chat IDs',
  path: ['targetChatIds']
});

// Message delivery status schema
export const messageDeliveryStatusSchema = z.object({
  messageId: z.string()
    .min(1, 'Message ID required'),
  status: z.enum([
    MESSAGE_STATUS.SENT,
    MESSAGE_STATUS.DELIVERED,
    MESSAGE_STATUS.READ,
    MESSAGE_STATUS.FAILED
  ] as const),
  timestamp: z.date()
    .default(() => new Date()),
  recipientId: z.string()
    .min(1, 'Recipient ID required')
    .optional()
});

// Message typing indicator schema
export const messageTypingSchema = z.object({
  chatId: z.string()
    .min(1, 'Chat ID required'),
  isTyping: z.boolean(),
  timestamp: z.date()
    .default(() => new Date())
});