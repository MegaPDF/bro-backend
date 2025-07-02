import { z } from 'zod';
import { ADMIN_ROLES, ADMIN_PERMISSIONS, REGEX_PATTERNS, DEFAULTS } from '@/lib/utils/constants';

// Permission set schema
export const permissionSetSchema = z.object({
  read: z.boolean().default(false),
  write: z.boolean().default(false),
  delete: z.boolean().default(false)
});

// Admin permissions schema
export const adminPermissionsSchema = z.object({
  [ADMIN_PERMISSIONS.USERS]: permissionSetSchema.optional(),
  [ADMIN_PERMISSIONS.MESSAGES]: permissionSetSchema.optional(),
  [ADMIN_PERMISSIONS.GROUPS]: permissionSetSchema.optional(),
  [ADMIN_PERMISSIONS.REPORTS]: permissionSetSchema.optional(),
  [ADMIN_PERMISSIONS.ANALYTICS]: permissionSetSchema.optional(),
  [ADMIN_PERMISSIONS.SETTINGS]: permissionSetSchema.optional(),
  [ADMIN_PERMISSIONS.BROADCASTS]: permissionSetSchema.optional()
});

// Admin login history schema
export const adminLoginHistorySchema = z.object({
  ip: z.string()
    .min(1, 'IP address required')
    .max(45, 'IP address too long'), // IPv6 max length
  userAgent: z.string()
    .min(1, 'User agent required')
    .max(500, 'User agent too long'),
  loginAt: z.date()
    .default(() => new Date()),
  success: z.boolean()
});

// Admin create schema
export const adminCreateSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be less than 30 characters')
    .regex(/^[a-zA-Z0-9._]+$/, 'Username can only contain letters, numbers, dots and underscores'),
  email: z.string()
    .email('Invalid email format')
    .max(100, 'Email too long'),
  password: z.string()
    .regex(REGEX_PATTERNS.PASSWORD, 'Password must be at least 8 characters with uppercase, lowercase, number and special character'),
  fullName: z.string()
    .min(1, 'Full name is required')
    .max(100, 'Full name must be less than 100 characters')
    .trim(),
  avatar: z.string()
    .url('Invalid avatar URL')
    .optional(),
  role: z.enum([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.MODERATOR,
    ADMIN_ROLES.SUPPORT
  ] as const, {
    errorMap: () => ({ message: 'Invalid admin role' })
  }),
  permissions: adminPermissionsSchema.optional(),
  twoFactorEnabled: z.boolean()
    .default(false)
});

// Admin update schema
export const adminUpdateSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be less than 30 characters')
    .regex(/^[a-zA-Z0-9._]+$/, 'Username can only contain letters, numbers, dots and underscores')
    .optional(),
  email: z.string()
    .email('Invalid email format')
    .max(100, 'Email too long')
    .optional(),
  fullName: z.string()
    .min(1, 'Full name is required')
    .max(100, 'Full name must be less than 100 characters')
    .trim()
    .optional(),
  avatar: z.string()
    .url('Invalid avatar URL')
    .optional(),
  role: z.enum([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.MODERATOR,
    ADMIN_ROLES.SUPPORT
  ] as const).optional(),
  permissions: adminPermissionsSchema.optional(),
  isActive: z.boolean().optional(),
  twoFactorEnabled: z.boolean().optional()
});

// Admin login schema
export const adminLoginSchema = z.object({
  username: z.string()
    .min(1, 'Username is required'),
  password: z.string()
    .min(1, 'Password is required'),
  twoFactorCode: z.string()
    .length(6, 'Two-factor code must be 6 digits')
    .regex(/^\d{6}$/, 'Two-factor code must contain only digits')
    .optional(),
  rememberMe: z.boolean()
    .default(false)
});

// Admin search schema
export const adminSearchSchema = z.object({
  q: z.string()
    .max(100, 'Search query too long')
    .optional(),
  role: z.enum([
    ADMIN_ROLES.SUPER_ADMIN,
    ADMIN_ROLES.ADMIN,
    ADMIN_ROLES.MODERATOR,
    ADMIN_ROLES.SUPPORT
  ] as const).optional(),
  isActive: z.boolean().optional(),
  createdBy: z.string()
    .min(1, 'Creator ID required')
    .optional(),
  lastLoginFrom: z.coerce.date().optional(),
  lastLoginTo: z.coerce.date().optional(),
  page: z.coerce.number()
    .int()
    .min(1, 'Page must be at least 1')
    .default(1),
  limit: z.coerce.number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(DEFAULTS.PAGINATION_LIMIT),
  sort: z.enum(['createdAt', 'lastLogin', 'username', 'role'])
    .default('createdAt'),
  order: z.enum(['asc', 'desc'])
    .default('desc')
});

// Admin password change schema
export const adminPasswordChangeSchema = z.object({
  currentPassword: z.string()
    .min(1, 'Current password required'),
  newPassword: z.string()
    .regex(REGEX_PATTERNS.PASSWORD, 'Password must be at least 8 characters with uppercase, lowercase, number and special character'),
  confirmPassword: z.string()
    .min(1, 'Password confirmation required')
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
});
