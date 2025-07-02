import { z } from 'zod';
import { STATUS_TYPES, PRIVACY_LEVELS, DEFAULTS, REGEX_PATTERNS } from '@/lib/utils/constants';

// Status privacy schema
export const statusPrivacySchema = z.object({
  type: z.enum(['everyone', 'contacts', 'contacts_except', 'only_share_with'], {
    errorMap: () => ({ message: 'Invalid privacy type' })
  }).default('contacts'),
  excludedContacts: z.array(z.string().min(1, 'Contact ID required'))
    .max(100, 'Too many excluded contacts')
    .optional(),
  selectedContacts: z.array(z.string().min(1, 'Contact ID required'))
    .max(100, 'Too many selected contacts')
    .optional()
});

// Status viewer schema
export const statusViewerSchema = z.object({
  userId: z.string()
    .min(1, 'User ID required'),
  viewedAt: z.date()
    .default(() => new Date())
});

// Status create schema
export const statusCreateSchema = z.object({
  type: z.enum([STATUS_TYPES.TEXT, STATUS_TYPES.IMAGE, STATUS_TYPES.VIDEO] as const, {
    errorMap: () => ({ message: 'Status type must be text, image, or video' })
  }),
  content: z.string()
    .max(700, 'Status text must be less than 700 characters')
    .optional(),
  mediaId: z.string()
    .min(1, 'Media ID required')
    .optional(),
  backgroundColor: z.string()
    .regex(REGEX_PATTERNS.HEX_COLOR, 'Invalid hex color format')
    .optional(),
  textColor: z.string()
    .regex(REGEX_PATTERNS.HEX_COLOR, 'Invalid hex color format')
    .optional(),
  font: z.string()
    .max(50, 'Font name too long')
    .optional(),
  privacy: statusPrivacySchema.optional()
}).refine((data) => {
  // Text status requires content
  if (data.type === STATUS_TYPES.TEXT && !data.content?.trim()) {
    return false;
  }
  // Image/video status requires mediaId
  if ([STATUS_TYPES.IMAGE, STATUS_TYPES.VIDEO].includes(data.type as any) && !data.mediaId) {
    return false;
  }
  return true;
}, {
  message: 'Invalid status content for the specified type',
  path: ['content']
});

// Status update schema
export const statusUpdateSchema = z.object({
  content: z.string()
    .max(700, 'Status text must be less than 700 characters')
    .optional(),
  backgroundColor: z.string()
    .regex(REGEX_PATTERNS.HEX_COLOR, 'Invalid hex color format')
    .optional(),
  textColor: z.string()
    .regex(REGEX_PATTERNS.HEX_COLOR, 'Invalid hex color format')
    .optional(),
  font: z.string()
    .max(50, 'Font name too long')
    .optional(),
  privacy: statusPrivacySchema.optional()
});

// Status view schema
export const statusViewSchema = z.object({
  statusId: z.string()
    .min(1, 'Status ID required')
});

// Status search schema
export const statusSearchSchema = z.object({
  userId: z.string()
    .min(1, 'User ID required')
    .optional(),
  type: z.enum([STATUS_TYPES.TEXT, STATUS_TYPES.IMAGE, STATUS_TYPES.VIDEO] as const).optional(),
  isActive: z.boolean().optional(),
  viewerId: z.string()
    .min(1, 'Viewer ID required')
    .optional(),
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
  sort: z.enum(['createdAt', 'viewCount'])
    .default('createdAt'),
  order: z.enum(['asc', 'desc'])
    .default('desc')
});

// Status action schema
export const statusActionSchema = z.object({
  statusId: z.string()
    .min(1, 'Status ID required'),
  action: z.enum(['view', 'delete', 'report'], {
    errorMap: () => ({ message: 'Invalid status action' })
  }),
  reason: z.string()
    .max(200, 'Reason too long')
    .optional()
});