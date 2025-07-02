import { z } from 'zod';
import { REGEX_PATTERNS, DEFAULTS } from '@/lib/utils/constants';

// Privacy settings schema
export const userPrivacySettingsSchema = z.object({
  lastSeen: z.enum(['everyone', 'contacts', 'nobody'], {
    errorMap: () => ({ message: 'Invalid last seen privacy setting' })
  }).default('contacts'),
  profilePhoto: z.enum(['everyone', 'contacts', 'nobody'], {
    errorMap: () => ({ message: 'Invalid profile photo privacy setting' })
  }).default('contacts'),
  about: z.enum(['everyone', 'contacts', 'nobody'], {
    errorMap: () => ({ message: 'Invalid about privacy setting' })
  }).default('contacts'),
  readReceipts: z.boolean().default(true),
  groups: z.enum(['everyone', 'contacts', 'nobody'], {
    errorMap: () => ({ message: 'Invalid groups privacy setting' })
  }).default('contacts'),
  calls: z.enum(['everyone', 'contacts', 'nobody'], {
    errorMap: () => ({ message: 'Invalid calls privacy setting' })
  }).default('contacts'),
  status: z.enum(['everyone', 'contacts', 'nobody'], {
    errorMap: () => ({ message: 'Invalid status privacy setting' })
  }).default('contacts')
});

// Security settings schema
export const userSecuritySettingsSchema = z.object({
  twoFactorEnabled: z.boolean().default(false),
  backupEnabled: z.boolean().default(true),
  disappearingMessages: z.number()
    .min(0, 'Disappearing messages duration must be non-negative')
    .max(604800, 'Maximum duration is 7 days')
    .default(0),
  fingerprintLock: z.boolean().default(false),
  autoDownloadMedia: z.boolean().default(true)
});

// Notification settings schema
export const userNotificationSettingsSchema = z.object({
  messageNotifications: z.boolean().default(true),
  groupNotifications: z.boolean().default(true),
  callNotifications: z.boolean().default(true),
  statusNotifications: z.boolean().default(true),
  sound: z.string()
    .max(50, 'Sound name too long')
    .optional(),
  vibration: z.boolean().default(true),
  popupNotification: z.boolean().default(true)
});

// User create schema
export const userCreateSchema = z.object({
  phoneNumber: z.string()
    .regex(REGEX_PATTERNS.PHONE_NUMBER, 'Invalid phone number format'),
  countryCode: z.string()
    .min(1, 'Country code required')
    .max(4, 'Country code too long'),
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(50, 'Display name must be less than 50 characters')
    .trim(),
  email: z.string()
    .email('Invalid email format')
    .max(100, 'Email too long')
    .optional(),
  username: z.string()
    .regex(REGEX_PATTERNS.USERNAME, 'Username must be 3-30 characters, letters, numbers, dots and underscores only')
    .optional()
});

// User update schema
export const userUpdateSchema = z.object({
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(50, 'Display name must be less than 50 characters')
    .trim()
    .optional(),
  about: z.string()
    .max(139, 'About text must be less than 139 characters')
    .optional(),
  avatar: z.string()
    .url('Invalid avatar URL')
    .optional(),
  username: z.string()
    .regex(REGEX_PATTERNS.USERNAME, 'Username must be 3-30 characters, letters, numbers, dots and underscores only')
    .optional(),
  privacySettings: userPrivacySettingsSchema.partial().optional(),
  securitySettings: userSecuritySettingsSchema.partial().optional(),
  notificationSettings: userNotificationSettingsSchema.partial().optional()
});

// User search schema
export const userSearchSchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit cannot exceed 100').default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().max(100, 'Search query too long').optional(),
  filters: z.record(z.any()).optional(),
  status: z.enum(['active', 'blocked', 'suspended', 'deleted'], {
    errorMap: () => ({ message: 'Invalid user status' })
  }).optional(),
  isVerified: z.boolean().optional(),
  isOnline: z.boolean().optional()
});

// User contact schema
export const userContactSchema = z.object({
  contactUserId: z.string()
    .min(1, 'Contact user ID required'),
  name: z.string()
    .min(1, 'Contact name required')
    .max(100, 'Contact name too long'),
  phoneNumber: z.string()
    .regex(REGEX_PATTERNS.PHONE_NUMBER, 'Invalid phone number format'),
  email: z.string()
    .email('Invalid email format')
    .optional(),
  avatar: z.string()
    .url('Invalid avatar URL')
    .optional(),
  source: z.enum(['phone_contacts', 'manual_add', 'qr_code', 'group', 'broadcast'], {
    errorMap: () => ({ message: 'Invalid contact source' })
  }).default('manual_add')
});

// User block/unblock schema
export const userBlockSchema = z.object({
  targetUserId: z.string()
    .min(1, 'Target user ID required'),
  reason: z.string()
    .max(200, 'Block reason too long')
    .optional()
});

// User report schema
export const userReportSchema = z.object({
  reportedUserId: z.string()
    .min(1, 'Reported user ID required'),
  reason: z.enum(['spam', 'harassment', 'inappropriate_content', 'fake_account', 'other'], {
    errorMap: () => ({ message: 'Invalid report reason' })
  }),
  description: z.string()
    .min(1, 'Report description required')
    .max(500, 'Report description too long'),
  evidence: z.array(z.object({
    type: z.enum(['screenshot', 'message', 'media']),
    content: z.string().min(1, 'Evidence content required')
  })).max(5, 'Too many evidence items').optional()
});