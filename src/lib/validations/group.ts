import { z } from 'zod';
import { DEFAULTS } from '@/lib/utils/constants';

// Group member schema
export const groupMemberSchema = z.object({
  userId: z.string()
    .min(1, 'User ID required'),
  role: z.enum(['member', 'admin'], {
    errorMap: () => ({ message: 'Role must be member or admin' })
  }).default('member'),
  joinedAt: z.date()
    .default(() => new Date()),
  addedBy: z.string()
    .min(1, 'Added by user ID required')
});

// Group create schema
export const groupCreateSchema = z.object({
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
  members: z.array(z.string().min(1, 'Member ID required'))
    .min(1, 'At least one member required')
    .max(DEFAULTS.GROUP_MAX_MEMBERS - 1, `Maximum ${DEFAULTS.GROUP_MAX_MEMBERS - 1} members allowed (excluding creator)`),
  settings: z.object({
    onlyAdminsCanMessage: z.boolean().default(false),
    onlyAdminsCanEditGroupInfo: z.boolean().default(false),
    onlyAdminsCanAddMembers: z.boolean().default(false),
    approvalRequired: z.boolean().default(false),
    disappearingMessages: z.object({
      enabled: z.boolean().default(false),
      duration: z.number()
        .min(0, 'Duration must be non-negative')
        .max(604800, 'Maximum duration is 7 days')
        .default(0)
    }).optional()
  }).optional()
});

// Group update schema
export const groupUpdateSchema = z.object({
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
  settings: z.object({
    onlyAdminsCanMessage: z.boolean().optional(),
    onlyAdminsCanEditGroupInfo: z.boolean().optional(),
    onlyAdminsCanAddMembers: z.boolean().optional(),
    approvalRequired: z.boolean().optional(),
    disappearingMessages: z.object({
      enabled: z.boolean(),
      duration: z.number()
        .min(0, 'Duration must be non-negative')
        .max(604800, 'Maximum duration is 7 days')
    }).partial().optional()
  }).optional()
});

// Group member management schema
export const groupMemberManagementSchema = z.object({
  groupId: z.string()
    .min(1, 'Group ID required'),
  userIds: z.array(z.string().min(1, 'User ID required'))
    .min(1, 'At least one user ID required')
    .max(50, 'Too many users for single operation'),
  action: z.enum(['add', 'remove', 'promote', 'demote'], {
    errorMap: () => ({ message: 'Invalid member action' })
  }),
  reason: z.string()
    .max(200, 'Reason too long')
    .optional()
});

// Group invite schema
export const groupInviteSchema = z.object({
  groupId: z.string()
    .min(1, 'Group ID required'),
  inviteCode: z.string()
    .min(1, 'Invite code required')
    .max(50, 'Invite code too long'),
  expiresAt: z.date()
    .min(new Date(), 'Expiry date must be in the future')
    .optional(),
  maxUses: z.number()
    .int()
    .min(1, 'Max uses must be at least 1')
    .max(1000, 'Max uses cannot exceed 1000')
    .optional()
});

// Join group schema
export const joinGroupSchema = z.object({
  inviteCode: z.string()
    .min(1, 'Invite code required')
    .max(50, 'Invite code too long')
});

// Group search schema
export const groupSearchSchema = z.object({
  q: z.string()
    .max(100, 'Search query too long')
    .optional(),
  creatorId: z.string()
    .min(1, 'Creator ID required')
    .optional(),
  isActive: z.boolean().optional(),
  memberCount: z.object({
    min: z.number().int().min(0).optional(),
    max: z.number().int().max(DEFAULTS.GROUP_MAX_MEMBERS).optional()
  }).optional(),
  page: z.coerce.number()
    .int()
    .min(1, 'Page must be at least 1')
    .default(1),
  limit: z.coerce.number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(DEFAULTS.PAGINATION_LIMIT),
  sort: z.enum(['createdAt', 'memberCount', 'name'])
    .default('createdAt'),
  order: z.enum(['asc', 'desc'])
    .default('desc')
});

// Group exit schema
export const groupExitSchema = z.object({
  groupId: z.string()
    .min(1, 'Group ID required'),
  reason: z.string()
    .max(200, 'Reason too long')
    .optional()
});
