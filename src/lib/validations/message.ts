import { z } from 'zod';
import { MESSAGE_TYPES, MESSAGE_STATUS, REGEX_PATTERNS, DEFAULTS } from '@/lib/utils/constants';

// Location data schema
export const locationDataSchema = z.object({
  latitude: z.number()
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90'),
  longitude: z.number()
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180'),
  address: z.string()
    .max(200, 'Address must be less than 200 characters')
    .optional()
});

// Contact data schema
export const contactDataSchema = z.object({
  name: z.string()
    .min(1, 'Contact name is required')
    .max(100, 'Contact name must be less than 100 characters'),
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
    .min(1, 'Chat ID is required'),
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
    .min(1, 'Message content is required')
    .max(4096, 'Message content must be less than 4096 characters'),
  mediaId: z.string()
    .min(1, 'Media ID required')
    .optional(),
  location: locationDataSchema.optional(),
  contact: contactDataSchema.optional(),
  replyTo: z.string()
    .min(1, 'Reply message ID required')
    .optional(),
  mentions: z.array(z.string().min(1, 'Mentioned user ID required'))
    .max(10, 'Maximum 10 mentions allowed')
    .optional(),
  isForwarded: z.boolean()
    .default(false),
  forwardedFrom: z.string()
    .min(1, 'Forwarded from user ID required')
    .optional()
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
  if ([MESSAGE_TYPES.IMAGE, MESSAGE_TYPES.VIDEO, MESSAGE_TYPES.AUDIO, MESSAGE_TYPES.DOCUMENT, MESSAGE_TYPES.VOICE].includes(data.type as any) && !data.mediaId) {
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
    .min(1, 'Message content is required')
    .max(4096, 'Message content must be less than 4096 characters')
    .optional(),
  reactions: z.array(messageReactionSchema)
    .max(50, 'Too many reactions')
    .optional()
});

// Message search schema
export const messageSearchSchema = z.object({
  q: z.string()
    .max(100, 'Search query too long')
    .optional(),
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
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number()
    .int()
    .min(1, 'Page must be at least 1')
    .default(1),
  limit: z.coerce.number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(DEFAULTS.PAGINATION_LIMIT),
  sort: z.enum(['createdAt', 'updatedAt'])
    .default('createdAt'),
  order: z.enum(['asc', 'desc'])
    .default('desc')
});

// Message action schema (star, delete, etc.)
export const messageActionSchema = z.object({
  messageId: z.string()
    .min(1, 'Message ID required'),
  action: z.enum(['star', 'unstar', 'delete', 'delete_for_everyone'], {
    errorMap: () => ({ message: 'Invalid message action' })
  }),
  reason: z.string()
    .max(200, 'Reason too long')
    .optional()
});

// Bulk message action schema
export const bulkMessageActionSchema = z.object({
  messageIds: z.array(z.string().min(1, 'Message ID required'))
    .min(1, 'At least one message ID required')
    .max(100, 'Too many messages for bulk operation'),
  action: z.enum(['star', 'unstar', 'delete', 'forward'], {
    errorMap: () => ({ message: 'Invalid bulk action' })
  }),
  targetChatIds: z.array(z.string().min(1, 'Target chat ID required'))
    .max(10, 'Too many target chats')
    .optional() // Required for forward action
});

// Message reaction action schema
export const messageReactionActionSchema = z.object({
  messageId: z.string()
    .min(1, 'Message ID required'),
  emoji: z.string()
    .min(1, 'Emoji required')
    .max(10, 'Emoji too long'),
  action: z.enum(['add', 'remove'], {
    errorMap: () => ({ message: 'Reaction action must be add or remove' })
  })
});

// Read receipt schema
export const readReceiptSchema = z.object({
  messageId: z.string()
    .min(1, 'Message ID required'),
  chatId: z.string()
    .min(1, 'Chat ID required')
});