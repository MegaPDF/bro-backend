import { z } from 'zod';
import { MEDIA_TYPES, MEDIA_USAGE, FILE_SIZE_LIMITS, SUPPORTED_FILE_TYPES, DEFAULTS } from '@/lib/utils/constants';

// Media dimensions schema
export const mediaDimensionsSchema = z.object({
  width: z.number()
    .int()
    .min(1, 'Width must be positive')
    .max(8192, 'Width too large'),
  height: z.number()
    .int()
    .min(1, 'Height must be positive')
    .max(8192, 'Height too large')
});

// Media upload schema
export const mediaUploadSchema = z.object({
  originalName: z.string()
    .min(1, 'Original filename required')
    .max(255, 'Filename too long'),
  mimeType: z.string()
    .min(1, 'MIME type required')
    .max(100, 'MIME type too long'),
  size: z.number()
    .int()
    .min(1, 'File size must be positive')
    .max(FILE_SIZE_LIMITS.DOCUMENT, 'File too large'),
  type: z.enum([
    MEDIA_TYPES.IMAGE,
    MEDIA_TYPES.VIDEO,
    MEDIA_TYPES.AUDIO,
    MEDIA_TYPES.DOCUMENT,
    MEDIA_TYPES.VOICE
  ] as const, {
    errorMap: () => ({ message: 'Invalid media type' })
  }),
  usage: z.enum([
    MEDIA_USAGE.MESSAGE,
    MEDIA_USAGE.STATUS,
    MEDIA_USAGE.PROFILE,
    MEDIA_USAGE.GROUP,
    MEDIA_USAGE.CALL_RECORDING
  ] as const, {
    errorMap: () => ({ message: 'Invalid media usage' })
  }),
  duration: z.number()
    .min(0, 'Duration must be non-negative')
    .max(3600, 'Duration too long (max 1 hour)')
    .optional(),
  dimensions: mediaDimensionsSchema.optional(),
  quality: z.number()
    .min(1, 'Quality must be at least 1')
    .max(100, 'Quality cannot exceed 100')
    .default(DEFAULTS.MEDIA_COMPRESSION_QUALITY),
  generateThumbnail: z.boolean()
    .default(true),
  encrypt: z.boolean()
    .default(false)
}).refine((data) => {
  // Validate file size based on type
  const maxSize = FILE_SIZE_LIMITS[data.type.toUpperCase() as keyof typeof FILE_SIZE_LIMITS];
  if (data.size > maxSize) {
    return false;
  }
  
  // Validate file extension
  const extension = `.${data.originalName.split('.').pop()?.toLowerCase()}`;
  const allowedExtensions = SUPPORTED_FILE_TYPES[data.type.toUpperCase() as keyof typeof SUPPORTED_FILE_TYPES];
  return allowedExtensions.includes(extension);
}, {
  message: 'File type or size not supported for this media type',
  path: ['originalName']
});

// Media update schema
export const mediaUpdateSchema = z.object({
  usage: z.enum([
    MEDIA_USAGE.MESSAGE,
    MEDIA_USAGE.STATUS,
    MEDIA_USAGE.PROFILE,
    MEDIA_USAGE.GROUP,
    MEDIA_USAGE.CALL_RECORDING
  ] as const).optional(),
  metadata: z.record(z.any()).optional()
});

// Media search schema
export const mediaSearchSchema = z.object({
  uploadedBy: z.string()
    .min(1, 'Uploader ID required')
    .optional(),
  type: z.enum([
    MEDIA_TYPES.IMAGE,
    MEDIA_TYPES.VIDEO,
    MEDIA_TYPES.AUDIO,
    MEDIA_TYPES.DOCUMENT,
    MEDIA_TYPES.VOICE
  ] as const).optional(),
  usage: z.enum([
    MEDIA_USAGE.MESSAGE,
    MEDIA_USAGE.STATUS,
    MEDIA_USAGE.PROFILE,
    MEDIA_USAGE.GROUP,
    MEDIA_USAGE.CALL_RECORDING
  ] as const).optional(),
  isDeleted: z.boolean().optional(),
  sizeMin: z.number()
    .int()
    .min(0, 'Minimum size must be non-negative')
    .optional(),
  sizeMax: z.number()
    .int()
    .min(1, 'Maximum size must be positive')
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
  sort: z.enum(['createdAt', 'size', 'downloadCount'])
    .default('createdAt'),
  order: z.enum(['asc', 'desc'])
    .default('desc')
});

// Presigned URL schema
export const presignedUrlSchema = z.object({
  filename: z.string()
    .min(1, 'Filename required')
    .max(255, 'Filename too long'),
  mimeType: z.string()
    .min(1, 'MIME type required')
    .max(100, 'MIME type too long'),
  usage: z.enum([
    MEDIA_USAGE.MESSAGE,
    MEDIA_USAGE.STATUS,
    MEDIA_USAGE.PROFILE,
    MEDIA_USAGE.GROUP,
    MEDIA_USAGE.CALL_RECORDING
  ] as const),
  expiresIn: z.number()
    .int()
    .min(60, 'Minimum expiry is 1 minute')
    .max(3600, 'Maximum expiry is 1 hour')
    .default(3600)
});
