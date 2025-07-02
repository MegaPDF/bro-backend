import { z } from 'zod';
import { DEFAULTS } from '../utils/constants';

// Settings category enum
const settingsCategories = ['aws', 'email', 'coturn', 'push_notifications', 'general', 'security', 'features'] as const;
const settingsTypes = ['string', 'number', 'boolean', 'object', 'array'] as const;

// Settings create schema
export const settingsCreateSchema = z.object({
  category: z.enum(settingsCategories, {
    errorMap: () => ({ message: 'Invalid settings category' })
  }),
  key: z.string()
    .min(1, 'Settings key is required')
    .max(100, 'Settings key must be less than 100 characters')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Settings key can only contain letters, numbers, dots, underscores and hyphens'),
  value: z.any(), // Will be validated based on type
  type: z.enum(settingsTypes, {
    errorMap: () => ({ message: 'Invalid settings type' })
  }),
  description: z.string()
    .min(1, 'Description is required')
    .max(200, 'Description must be less than 200 characters'),
  isEncrypted: z.boolean()
    .default(false),
  isPublic: z.boolean()
    .default(false)
}).refine((data) => {
  // Validate value based on type
  switch (data.type) {
    case 'string':
      return typeof data.value === 'string';
    case 'number':
      return typeof data.value === 'number' && !isNaN(data.value);
    case 'boolean':
      return typeof data.value === 'boolean';
    case 'object':
      return typeof data.value === 'object' && data.value !== null && !Array.isArray(data.value);
    case 'array':
      return Array.isArray(data.value);
    default:
      return true;
  }
}, {
  message: 'Value type does not match specified type',
  path: ['value']
});

// Settings update schema
export const settingsUpdateSchema = z.object({
  value: z.any(), // Will be validated based on existing type
  description: z.string()
    .min(1, 'Description is required')
    .max(200, 'Description must be less than 200 characters')
    .optional(),
  isEncrypted: z.boolean().optional(),
  isPublic: z.boolean().optional()
});

// Settings search schema
export const settingsSearchSchema = z.object({
  category: z.enum(settingsCategories).optional(),
  key: z.string()
    .max(100, 'Key too long')
    .optional(),
  isPublic: z.boolean().optional(),
  isEncrypted: z.boolean().optional(),
  type: z.enum(settingsTypes).optional(),
  page: z.coerce.number()
    .int()
    .min(1, 'Page must be at least 1')
    .default(1),
  limit: z.coerce.number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(DEFAULTS.PAGINATION_LIMIT),
  sort: z.enum(['category', 'key', 'updatedAt'])
    .default('category'),
  order: z.enum(['asc', 'desc'])
    .default('asc')
});

// Bulk settings update schema
export const settingsBulkUpdateSchema = z.object({
  settings: z.array(z.object({
    key: z.string()
      .min(1, 'Settings key required')
      .max(100, 'Settings key too long'),
    value: z.any(),
    category: z.enum(settingsCategories)
  })).min(1, 'At least one setting required')
    .max(50, 'Too many settings for bulk operation')
});

// AWS settings schema
export const awsSettingsSchema = z.object({
  region: z.string()
    .min(1, 'AWS region required'),
  accessKeyId: z.string()
    .min(1, 'AWS access key ID required'),
  secretAccessKey: z.string()
    .min(1, 'AWS secret access key required'),
  s3Bucket: z.string()
    .min(1, 'S3 bucket name required'),
  s3Region: z.string()
    .min(1, 'S3 region required')
});

// Email settings schema
export const emailSettingsSchema = z.object({
  provider: z.enum(['sendgrid', 'nodemailer'], {
    errorMap: () => ({ message: 'Email provider must be sendgrid or nodemailer' })
  }),
  sendgridApiKey: z.string()
    .min(1, 'SendGrid API key required')
    .optional(),
  smtpHost: z.string()
    .min(1, 'SMTP host required')
    .optional(),
  smtpPort: z.number()
    .int()
    .min(1, 'SMTP port must be positive')
    .max(65535, 'Invalid SMTP port')
    .optional(),
  smtpUser: z.string()
    .min(1, 'SMTP username required')
    .optional(),
  smtpPass: z.string()
    .min(1, 'SMTP password required')
    .optional(),
  fromEmail: z.string()
    .email('Invalid from email')
});

// Coturn settings schema
export const coturnSettingsSchema = z.object({
  servers: z.array(z.object({
    region: z.string()
      .min(1, 'Region required'),
    server: z.string()
      .min(1, 'Server URL required'),
    username: z.string()
      .min(1, 'Username required'),
    credential: z.string()
      .min(1, 'Credential required')
  })).min(1, 'At least one TURN server required'),
  loadBalancing: z.enum(['round_robin', 'geographic', 'random'])
    .default('geographic')
});

// Push notification settings schema
export const pushNotificationSettingsSchema = z.object({
  fcmServerKey: z.string()
    .min(1, 'FCM server key required'),
  apnsKeyId: z.string()
    .min(1, 'APNS key ID required'),
  apnsTeamId: z.string()
    .min(1, 'APNS team ID required'),
  apnsBundleId: z.string()
    .min(1, 'APNS bundle ID required'),
  vapidPublicKey: z.string()
    .min(1, 'VAPID public key required')
    .optional(),
  vapidPrivateKey: z.string()
    .min(1, 'VAPID private key required')
    .optional()
});