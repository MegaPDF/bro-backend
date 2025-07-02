import { z } from 'zod';
import { REGEX_PATTERNS, USER_STATUS, PRIVACY_LEVELS, DEFAULTS } from '@/lib/utils/constants';

// Privacy settings schema
export const privacySettingsSchema = z.object({
  lastSeen: z.enum([PRIVACY_LEVELS.EVERYONE, PRIVACY_LEVELS.CONTACTS, PRIVACY_LEVELS.NOBODY] as const)
    .default(PRIVACY_LEVELS.EVERYONE),
  profilePhoto: z.enum([PRIVACY_LEVELS.EVERYONE, PRIVACY_LEVELS.CONTACTS, PRIVACY_LEVELS.NOBODY] as const)
    .default(PRIVACY_LEVELS.EVERYONE),
  about: z.enum([PRIVACY_LEVELS.EVERYONE, PRIVACY_LEVELS.CONTACTS, PRIVACY_LEVELS.NOBODY] as const)
    .default(PRIVACY_LEVELS.EVERYONE),
  readReceipts: z.boolean()
    .default(true),
  groups: z.enum([PRIVACY_LEVELS.EVERYONE, PRIVACY_LEVELS.CONTACTS, PRIVACY_LEVELS.NOBODY] as const)
    .default(PRIVACY_LEVELS.EVERYONE),
  calls: z.enum([PRIVACY_LEVELS.EVERYONE, PRIVACY_LEVELS.CONTACTS, PRIVACY_LEVELS.NOBODY] as const)
    .default(PRIVACY_LEVELS.EVERYONE),
  status: z.enum([PRIVACY_LEVELS.EVERYONE, PRIVACY_LEVELS.CONTACTS, PRIVACY_LEVELS.NOBODY] as const)
    .default(PRIVACY_LEVELS.CONTACTS)
});

// Security settings schema
export const securitySettingsSchema = z.object({
  twoFactorEnabled: z.boolean()
    .default(false),
  backupEnabled: z.boolean()
    .default(true),
  disappearingMessages: z.number()
    .min(0, 'Disappearing messages duration must be non-negative')
    .max(604800, 'Maximum disappearing messages duration is 7 days')
    .default(0),
  fingerprintLock: z.boolean()
    .default(false),
  autoDownloadMedia: z.boolean()
    .default(true)
});

// Notification settings schema
export const notificationSettingsSchema = z.object({
  messageNotifications: z.boolean()
    .default(true),
  groupNotifications: z.boolean()
    .default(true),
  callNotifications: z.boolean()
    .default(true),
  statusNotifications: z.boolean()
    .default(true),
  sound: z.string()
    .max(50, 'Sound name too long')
    .default('default'),
  vibration: z.boolean()
    .default(true),
  popupNotification: z.boolean()
    .default(true)
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
    .optional(),
  username: z.string()
    .regex(REGEX_PATTERNS.USERNAME, 'Username must be 3-30 characters, letters, numbers, dots and underscores only')
    .optional(),
  avatar: z.string()
    .url('Invalid avatar URL')
    .optional(),
  about: z.string()
    .max(139, 'About text must be less than 139 characters')
    .default(DEFAULTS.USER_ABOUT)
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
  privacySettings: privacySettingsSchema.partial().optional(),
  securitySettings: securitySettingsSchema.partial().optional(),
  notificationSettings: notificationSettingsSchema.partial().optional()
});

// User search schema
export const userSearchSchema = z.object({
  q: z.string()
    .max(100, 'Search query too long')
    .optional(),
  status: z.enum([
    USER_STATUS.ACTIVE,
    USER_STATUS.BLOCKED,
    USER_STATUS.SUSPENDED,
    USER_STATUS.DELETED
  ] as const).optional(),
  isVerified: z.boolean().optional(),
  isOnline: z.boolean().optional(),
  page: z.coerce.number()
    .int()
    .min(1, 'Page must be at least 1')
    .default(1),
  limit: z.coerce.number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  sort: z.string()
    .max(50, 'Sort field too long')
    .optional(),
  order: z.enum(['asc', 'desc'])
    .default('desc')
});

// Block user schema
export const blockUserSchema = z.object({
  userId: z.string()
    .min(1, 'User ID required'),
  reason: z.string()
    .max(200, 'Reason too long')
    .optional()
});

// User status update schema
export const userStatusUpdateSchema = z.object({
  status: z.enum([
    USER_STATUS.ACTIVE,
    USER_STATUS.BLOCKED,
    USER_STATUS.SUSPENDED
  ] as const),
  reason: z.string()
    .max(200, 'Reason too long')
    .optional()
});

// Device registration schema
export const deviceRegistrationSchema = z.object({
  deviceId: z.string()
    .min(1, 'Device ID required')
    .max(100, 'Device ID too long'),
  deviceName: z.string()
    .min(1, 'Device name required')
    .max(100, 'Device name too long'),
  platform: z.enum(['android', 'ios', 'web', 'desktop']),
  appVersion: z.string()
    .min(1, 'App version required')
    .max(20, 'App version too long'),
  pushToken: z.string()
    .max(500, 'Push token too long')
    .optional()
});
