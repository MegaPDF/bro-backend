
import { z } from 'zod';
import { DEFAULTS } from '@/lib/utils/constants';

// Disappearing messages settings schema
export const disappearingMessagesSchema = z.object({
  enabled: z.boolean()
    .default(false),
  duration: z.number()
    .min(0, 'Duration must be non-negative')
    .max(604800, 'Maximum duration is 7 days (604800 seconds)')
    .default(0),
  enabledBy: z.string()
    .min(1, 'Enabled by user ID required'),
  enabledAt: z.date()
    .default(() => new Date())
});

// Group settings schema
export const groupSettingsSchema = z.object({
  onlyAdminsCanMessage: z.boolean()
    .default(false),
  onlyAdminsCanEditGroupInfo: z.boolean()
    .default(false),
  approvalRequired: z.boolean()
    .default(false)
});

// Group info schema
export const groupInfoSchema = z.object({
  name: z.string()
    .min(1, 'Group name is required')
    .max(100, 'Group name must be less than 100 characters')
    .trim(),
  description: z.string()
    .max(500, 'Group description must be less than 500 characters')
    .optional(),
  avatar: z.string()
    .url('Invalid avatar URL')
    .optional(),
  admins: z.array(z.string().min(1, 'Admin ID required'))
    .min(1, 'At least one admin required'),
  creator: z.string()
    .min(1, 'Creator ID required'),
  inviteLink: z.string()
    .url('Invalid invite link')
    .optional(),
  settings: groupSettingsSchema
    .default({})
});

// Chat create schema
export const chatCreateSchema = z.object({
  type: z.enum(['individual', 'group'], {
    errorMap: () => ({ message: 'Chat type must be individual or group' })
  }),
  participants: z.array(z.string().min(1, 'Participant ID required'))
    .min(1, 'At least one participant required')
    .max(DEFAULTS.GROUP_MAX_MEMBERS, `Maximum ${DEFAULTS.GROUP_MAX_MEMBERS} participants allowed`),
  groupInfo: groupInfoSchema.optional()
}).refine((data) => {
  // Individual chats must have exactly 2 participants
  if (data.type === 'individual') {
    return data.participants.length === 2;
  }
  // Group chats must have group info
  if (data.type === 'group') {
    return data.groupInfo !== undefined;
  }
  return true;
}, {
  message: 'Invalid chat configuration: individual chats need 2 participants, group chats need group info',
  path: ['participants']
});

// Chat update schema
export const chatUpdateSchema = z.object({
  groupInfo: z.object({
    name: z.string()
      .min(1, 'Group name is required')
      .max(100, 'Group name must be less than 100 characters')
      .trim()
      .optional(),
    description: z.string()
      .max(500, 'Group description must be less than 500 characters')
      .optional(),
    avatar: z.string()
      .url('Invalid avatar URL')
      .optional(),
    settings: groupSettingsSchema.partial().optional()
  }).optional(),
  disappearingMessages: disappearingMessagesSchema.partial().optional()
});

// Chat list schema
export const chatListSchema = z.object({
  type: z.enum(['individual', 'group']).optional(),
  page: z.coerce.number()
    .int()
    .min(1, 'Page must be at least 1')
    .default(1),
  limit: z.coerce.number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(DEFAULTS.PAGINATION_LIMIT),
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
  muted: z.boolean().optional()
});

// Chat member action schema
export const chatMemberActionSchema = z.object({
  chatId: z.string()
    .min(1, 'Chat ID required'),
  userIds: z.array(z.string().min(1, 'User ID required'))
    .min(1, 'At least one user ID required')
    .max(50, 'Too many users for single operation'),
  action: z.enum(['add', 'remove', 'promote', 'demote'], {
    errorMap: () => ({ message: 'Invalid member action' })
  })
});

// Chat archive/pin/mute schema
export const chatStatusUpdateSchema = z.object({
  chatId: z.string()
    .min(1, 'Chat ID required'),
  action: z.enum(['archive', 'unarchive', 'pin', 'unpin', 'mute', 'unmute'], {
    errorMap: () => ({ message: 'Invalid chat action' })
  }),
  muteDuration: z.number()
    .min(0, 'Mute duration must be non-negative')
    .max(31536000, 'Maximum mute duration is 1 year')
    .optional()
});