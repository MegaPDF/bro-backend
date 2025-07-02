import { z } from 'zod';
import { REGEX_PATTERNS, FILE_SIZE_LIMITS, SUPPORTED_FILE_TYPES } from './constants';
import { ValidationHelpers } from './helpers';

// Base validation schemas
export const baseSchemas = {
  objectId: z.string().refine(ValidationHelpers.isValidObjectId, 'Invalid ID format'),
  email: z.string().email('Invalid email format'),
  phoneNumber: z.string().regex(REGEX_PATTERNS.PHONE_NUMBER, 'Invalid phone number format'),
  username: z.string().regex(REGEX_PATTERNS.USERNAME, 'Username must be 3-30 characters, letters, numbers, dots and underscores only'),
  password: z.string().regex(REGEX_PATTERNS.PASSWORD, 'Password must be at least 8 characters with uppercase, lowercase, number and special character'),
  otp: z.string().regex(REGEX_PATTERNS.OTP, 'OTP must be 6 digits'),
  hexColor: z.string().regex(REGEX_PATTERNS.HEX_COLOR, 'Invalid hex color format'),
  url: z.string().url('Invalid URL format'),
  positiveInteger: z.number().int().positive('Must be a positive integer'),
  nonNegativeInteger: z.number().int().min(0, 'Must be non-negative')
};

// Pagination validation
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit cannot exceed 100').default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc')
});

// Search validation
export const searchSchema = paginationSchema.extend({
  q: z.string().max(100, 'Search query too long').optional(),
  filters: z.record(z.any()).optional()
});

// File validation - FIXED VERSION
export const fileValidationSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  size: z.number().positive('File size must be positive'),
  mimeType: z.string().min(1, 'MIME type is required'),
  type: z.enum(['image', 'video', 'audio', 'document', 'voice'])
}).refine((data) => {
  // Validate file size based on type
  const maxSize = FILE_SIZE_LIMITS[data.type.toUpperCase() as keyof typeof FILE_SIZE_LIMITS];
  return data.size <= maxSize;
}, (data) => ({
  message: `File size exceeds limit for ${data.type} files`,
  path: ['size']
})).refine((data) => {
  // Validate file extension - FIXED
  const extension = data.filename.toLowerCase().split('.').pop();
  if (!extension) return false;
  
  const extensionWithDot = `.${extension}`;
  const allowedExtensions = SUPPORTED_FILE_TYPES[data.type.toUpperCase() as keyof typeof SUPPORTED_FILE_TYPES];
  
  // Type assertion to fix the TypeScript error
  return (allowedExtensions as readonly string[]).includes(extensionWithDot);
}, (data) => ({
  message: `File type not supported for ${data.type} files`,
  path: ['filename']
}));

// User validation schemas
export const userValidationSchemas = {
  create: z.object({
    phoneNumber: baseSchemas.phoneNumber,
    countryCode: z.string().min(1).max(4),
    displayName: z.string().min(1, 'Display name is required').max(50, 'Display name too long'),
    email: baseSchemas.email.optional(),
    username: baseSchemas.username.optional()
  }),

  update: z.object({
    displayName: z.string().min(1).max(50).optional(),
    about: z.string().max(139, 'About text too long').optional(),
    avatar: z.string().url().optional(),
    username: baseSchemas.username.optional(),
    privacySettings: z.object({
      lastSeen: z.enum(['everyone', 'contacts', 'nobody']).optional(),
      profilePhoto: z.enum(['everyone', 'contacts', 'nobody']).optional(),
      about: z.enum(['everyone', 'contacts', 'nobody']).optional(),
      readReceipts: z.boolean().optional(),
      groups: z.enum(['everyone', 'contacts', 'nobody']).optional(),
      calls: z.enum(['everyone', 'contacts', 'nobody']).optional(),
      status: z.enum(['everyone', 'contacts', 'nobody']).optional()
    }).optional(),
    securitySettings: z.object({
      twoFactorEnabled: z.boolean().optional(),
      backupEnabled: z.boolean().optional(),
      disappearingMessages: baseSchemas.nonNegativeInteger.optional(),
      fingerprintLock: z.boolean().optional(),
      autoDownloadMedia: z.boolean().optional()
    }).optional(),
    notificationSettings: z.object({
      messageNotifications: z.boolean().optional(),
      groupNotifications: z.boolean().optional(),
      callNotifications: z.boolean().optional(),
      statusNotifications: z.boolean().optional(),
      sound: z.string().optional(),
      vibration: z.boolean().optional(),
      popupNotification: z.boolean().optional()
    }).optional()
  }),

  search: searchSchema.extend({
    status: z.enum(['active', 'blocked', 'suspended', 'deleted']).optional(),
    isVerified: z.boolean().optional(),
    isOnline: z.boolean().optional()
  })
};

// Message validation schemas
export const messageValidationSchemas = {
  create: z.object({
    chatId: baseSchemas.objectId,
    type: z.enum(['text', 'image', 'video', 'audio', 'document', 'voice', 'location', 'contact', 'sticker', 'gif']),
    content: z.string().min(1, 'Content is required').max(4096, 'Message too long'),
    mediaId: baseSchemas.objectId.optional(),
    location: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      address: z.string().max(200).optional()
    }).optional(),
    contact: z.object({
      name: z.string().min(1).max(100),
      phoneNumber: baseSchemas.phoneNumber,
      avatar: z.string().url().optional()
    }).optional(),
    replyTo: baseSchemas.objectId.optional(),
    mentions: z.array(baseSchemas.objectId).max(10, 'Too many mentions').optional()
  }).refine((data) => {
    // Validate content based on message type
    if (data.type === 'text' && !data.content.trim()) {
      return false;
    }
    if (data.type === 'location' && !data.location) {
      return false;
    }
    if (data.type === 'contact' && !data.contact) {
      return false;
    }
    if (['image', 'video', 'audio', 'document', 'voice'].includes(data.type) && !data.mediaId) {
      return false;
    }
    return true;
  }, 'Invalid message content for type'),

  update: z.object({
    content: z.string().min(1).max(4096).optional(),
    reactions: z.array(z.object({
      userId: baseSchemas.objectId,
      emoji: z.string().min(1).max(10),
      createdAt: z.date()
    })).optional()
  }),

  search: searchSchema.extend({
    chatId: baseSchemas.objectId.optional(),
    senderId: baseSchemas.objectId.optional(),
    type: z.enum(['text', 'image', 'video', 'audio', 'document', 'voice', 'location', 'contact', 'sticker', 'gif']).optional(),
    status: z.enum(['sent', 'delivered', 'read', 'failed']).optional(),
    isStarred: z.boolean().optional(),
    isDeleted: z.boolean().optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional()
  })
};

// Chat validation schemas
export const chatValidationSchemas = {
  create: z.object({
    type: z.enum(['individual', 'group']),
    participants: z.array(baseSchemas.objectId).min(1, 'At least one participant required').max(256, 'Too many participants'),
    groupInfo: z.object({
      name: z.string().min(1, 'Group name required').max(100, 'Group name too long'),
      description: z.string().max(500, 'Description too long').optional(),
      avatar: z.string().url().optional(),
      settings: z.object({
        onlyAdminsCanMessage: z.boolean().default(false),
        onlyAdminsCanEditGroupInfo: z.boolean().default(false),
        approvalRequired: z.boolean().default(false)
      }).optional()
    }).optional()
  }).refine((data) => {
    if (data.type === 'group' && !data.groupInfo) {
      return false;
    }
    if (data.type === 'individual' && data.participants.length !== 2) {
      return false;
    }
    return true;
  }, 'Invalid chat configuration'),

  update: z.object({
    groupInfo: z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      avatar: z.string().url().optional(),
      settings: z.object({
        onlyAdminsCanMessage: z.boolean().optional(),
        onlyAdminsCanEditGroupInfo: z.boolean().optional(),
        approvalRequired: z.boolean().optional()
      }).optional()
    }).optional(),
    disappearingMessages: z.object({
      enabled: z.boolean(),
      duration: baseSchemas.nonNegativeInteger,
      enabledBy: baseSchemas.objectId
    }).optional()
  })
};

// Call validation schemas
export const callValidationSchemas = {
  initiate: z.object({
    type: z.enum(['voice', 'video']),
    callType: z.enum(['individual', 'group']),
    participants: z.array(baseSchemas.objectId).min(1).max(8, 'Too many participants for call'),
    chatId: baseSchemas.objectId.optional(),
    groupId: baseSchemas.objectId.optional()
  }),

  join: z.object({
    callId: baseSchemas.objectId,
    webrtcData: z.object({
      offer: z.string().optional(),
      answer: z.string().optional(),
      iceCandidates: z.array(z.string()).optional()
    }).optional()
  }),

  end: z.object({
    callId: baseSchemas.objectId,
    endReason: z.enum(['completed', 'declined', 'missed', 'failed', 'cancelled', 'busy'])
  })
};

// Status validation schemas
export const statusValidationSchemas = {
  create: z.object({
    type: z.enum(['text', 'image', 'video']),
    content: z.string().max(700, 'Status text too long').optional(),
    mediaId: baseSchemas.objectId.optional(),
    backgroundColor: baseSchemas.hexColor.optional(),
    textColor: baseSchemas.hexColor.optional(),
    font: z.string().max(50).optional(),
    privacy: z.object({
      type: z.enum(['everyone', 'contacts', 'contacts_except', 'only_share_with']),
      excludedContacts: z.array(baseSchemas.objectId).optional(),
      selectedContacts: z.array(baseSchemas.objectId).optional()
    }).optional()
  }).refine((data) => {
    if (data.type === 'text' && !data.content) {
      return false;
    }
    if (['image', 'video'].includes(data.type) && !data.mediaId) {
      return false;
    }
    return true;
  }, 'Invalid status content for type')
};

// Admin validation schemas
export const adminValidationSchemas = {
  create: z.object({
    username: z.string().min(3, 'Username too short').max(30, 'Username too long'),
    email: baseSchemas.email,
    password: baseSchemas.password,
    fullName: z.string().min(1, 'Full name required').max(100, 'Full name too long'),
    role: z.enum(['super_admin', 'admin', 'moderator', 'support']),
    permissions: z.object({
      users: z.object({
        read: z.boolean(),
        write: z.boolean(),
        delete: z.boolean()
      }).optional(),
      messages: z.object({
        read: z.boolean(),
        write: z.boolean(),
        delete: z.boolean()
      }).optional(),
      groups: z.object({
        read: z.boolean(),
        write: z.boolean(),
        delete: z.boolean()
      }).optional(),
      reports: z.object({
        read: z.boolean(),
        write: z.boolean(),
        delete: z.boolean()
      }).optional(),
      analytics: z.object({
        read: z.boolean(),
        write: z.boolean(),
        delete: z.boolean()
      }).optional(),
      settings: z.object({
        read: z.boolean(),
        write: z.boolean(),
        delete: z.boolean()
      }).optional(),
      broadcasts: z.object({
        read: z.boolean(),
        write: z.boolean(),
        delete: z.boolean()
      }).optional()
    }).optional()
  }),

  login: z.object({
    username: z.string().min(1, 'Username required'),
    password: z.string().min(1, 'Password required'),
    twoFactorCode: z.string().length(6).optional()
  })
};

// Settings validation schemas
export const settingsValidationSchemas = {
  create: z.object({
    category: z.enum(['aws', 'email', 'coturn', 'push_notifications', 'general', 'security', 'features']),
    key: z.string().min(1, 'Key required').max(100, 'Key too long'),
    value: z.any(),
    type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
    description: z.string().min(1, 'Description required').max(200, 'Description too long'),
    isEncrypted: z.boolean().default(false),
    isPublic: z.boolean().default(false)
  }),

  bulkUpdate: z.object({
    settings: z.array(z.object({
      key: z.string().min(1),
      value: z.any(),
      category: z.enum(['aws', 'email', 'coturn', 'push_notifications', 'general', 'security', 'features'])
    })).min(1, 'At least one setting required').max(50, 'Too many settings')
  })
};

// Export validation function
export function validateData<T>(schema: z.ZodSchema<T>, data: unknown): {
  success: boolean;
  data?: T;
  errors?: z.ZodError;
} {
  try {
    const validatedData = schema.parse(data);
    return { success: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error };
    }
    throw error;
  }
}

// Transform Zod errors to user-friendly format
export function formatValidationErrors(error: z.ZodError): Array<{
  field: string;
  message: string;
  code: string;
}> {
  return error.errors.map(err => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code
  }));
}