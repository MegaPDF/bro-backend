export const APP_CONFIG = {
  NAME: 'WhatsApp Clone',
  VERSION: '1.0.0',
  DESCRIPTION: 'A full-featured WhatsApp clone with Next.js and Flutter',
  SUPPORT_EMAIL: 'support@whatsappclone.com',
  WEBSITE: 'https://whatsappclone.com'
} as const;

// Database Constants
export const DB_COLLECTIONS = {
  USERS: 'users',
  CHATS: 'chats',
  MESSAGES: 'messages',
  GROUPS: 'groups',
  CALLS: 'calls',
  STATUS: 'status',
  CONTACTS: 'contacts',
  MEDIA: 'media',
  NOTIFICATIONS: 'notifications',
  REPORTS: 'reports',
  ADMINS: 'admins',
  SETTINGS: 'settings',
  ANALYTICS: 'analytics'
} as const;

// User Status Constants
export const USER_STATUS = {
  ACTIVE: 'active',
  BLOCKED: 'blocked',
  SUSPENDED: 'suspended',
  DELETED: 'deleted'
} as const;

// Privacy Levels
export const PRIVACY_LEVELS = {
  EVERYONE: 'everyone',
  CONTACTS: 'contacts',
  NOBODY: 'nobody'
} as const;

// Message Types
export const MESSAGE_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  DOCUMENT: 'document',
  VOICE: 'voice',
  LOCATION: 'location',
  CONTACT: 'contact',
  STICKER: 'sticker',
  GIF: 'gif'
} as const;

// Message Status
export const MESSAGE_STATUS = {
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed'
} as const;

// Call Types and Status
export const CALL_TYPES = {
  VOICE: 'voice',
  VIDEO: 'video'
} as const;

export const CALL_STATUS = {
  INITIATED: 'initiated',
  RINGING: 'ringing',
  CONNECTED: 'connected',
  ENDED: 'ended',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
} as const;

export const CALL_END_REASONS = {
  COMPLETED: 'completed',
  DECLINED: 'declined',
  MISSED: 'missed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  BUSY: 'busy'
} as const;

// Media Constants
export const MEDIA_TYPES = {
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  DOCUMENT: 'document',
  VOICE: 'voice'
} as const;

export const MEDIA_USAGE = {
  MESSAGE: 'message',
  STATUS: 'status',
  PROFILE: 'profile',
  GROUP: 'group',
  CALL_RECORDING: 'call_recording'
} as const;

// File Size Limits (in bytes)
export const FILE_SIZE_LIMITS = {
  IMAGE: 16 * 1024 * 1024, // 16MB
  VIDEO: 64 * 1024 * 1024, // 64MB
  AUDIO: 16 * 1024 * 1024, // 16MB
  DOCUMENT: 100 * 1024 * 1024, // 100MB
  VOICE: 10 * 1024 * 1024, // 10MB
  PROFILE_AVATAR: 5 * 1024 * 1024 // 5MB
} as const;

// Supported File Extensions
export const SUPPORTED_FILE_TYPES = {
  IMAGE: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
  VIDEO: ['.mp4', '.mov', '.avi', '.wmv', '.flv', '.webm', '.3gp'],
  AUDIO: ['.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac'],
  DOCUMENT: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf'],
  VOICE: ['.mp3', '.wav', '.aac', '.m4a', '.ogg']
} as const;

// MIME Types
export const MIME_TYPES = {
  IMAGE: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
  VIDEO: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/3gpp'],
  AUDIO: ['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/mp4', 'audio/ogg'],
  DOCUMENT: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]
} as const;

// Rate Limiting Constants
export const RATE_LIMITS = {
  SMS_OTP: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 3
  },
  LOGIN_ATTEMPTS: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 5
  },
  MESSAGE_SENDING: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 60 // 1 message per second
  },
  FILE_UPLOAD: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 10
  },
  API_GENERAL: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 1000
  }
} as const;

// OTP Constants
export const OTP_CONFIG = {
  LENGTH: 6,
  EXPIRY_MINUTES: 5,
  MAX_ATTEMPTS: 3,
  RESEND_COOLDOWN_SECONDS: 60,
  RATE_LIMIT_MINUTES: 1
} as const;

// JWT Constants
export const JWT_CONFIG = {
  ACCESS_TOKEN_EXPIRY: '1h',
  REFRESH_TOKEN_EXPIRY: '30d',
  QR_TOKEN_EXPIRY: '5m',
  ADMIN_TOKEN_EXPIRY: '8h'
} as const;

// Socket Events
export const SOCKET_EVENTS = {
  // Authentication
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  
  // Messages
  MESSAGE_SEND: 'message:send',
  MESSAGE_NEW: 'message:new',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_REACTION: 'message:reaction',
  MESSAGE_READ: 'message:read',
  MESSAGE_DELIVERED: 'message:delivered',
  
  // Chat
  CHAT_TYPING: 'chat:typing',
  CHAT_UPDATED: 'chat:updated',
  CHAT_MEMBER_ADDED: 'chat:member_added',
  CHAT_MEMBER_REMOVED: 'chat:member_removed',
  CHAT_JOIN: 'chat:join',
  CHAT_LEAVE: 'chat:leave',
  
  // User
  USER_ONLINE: 'user:online',
  USER_STATUS_UPDATED: 'user:status_updated',
  USER_PROFILE_UPDATED: 'user:profile_updated',
  USER_UPDATE_PRESENCE: 'user:update_presence',
  
  // Calls
  CALL_INCOMING: 'call:incoming',
  CALL_ACCEPTED: 'call:accepted',
  CALL_DECLINED: 'call:declined',
  CALL_ENDED: 'call:ended',
  CALL_INITIATE: 'call:initiate',
  CALL_WEBRTC_SIGNAL: 'call:webrtc_signal',
  
  // Status
  STATUS_NEW: 'status:new',
  STATUS_VIEWED: 'status:viewed',
  STATUS_VIEW: 'status:view',
  
  // Notifications
  NOTIFICATION_NEW: 'notification:new',
  
  // System
  SYSTEM_ERROR: 'system:error',
  SYSTEM_MAINTENANCE: 'system:maintenance'
} as const;

// Admin Roles and Permissions
export const ADMIN_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  SUPPORT: 'support'
} as const;

export const ADMIN_PERMISSIONS = {
  USERS: 'users',
  MESSAGES: 'messages',
  GROUPS: 'groups',
  REPORTS: 'reports',
  ANALYTICS: 'analytics',
  SETTINGS: 'settings',
  BROADCASTS: 'broadcasts'
} as const;

// Notification Types
export const NOTIFICATION_TYPES = {
  MESSAGE: 'message',
  CALL: 'call',
  GROUP_INVITE: 'group_invite',
  STATUS_VIEW: 'status_view',
  SYSTEM: 'system',
  BROADCAST: 'broadcast'
} as const;

// Status Types
export const STATUS_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video'
} as const;

// Error Codes
export const ERROR_CODES = {
  // Authentication
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_OTP: 'INVALID_OTP',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_MAX_ATTEMPTS: 'OTP_MAX_ATTEMPTS',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  
  // User
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_BLOCKED: 'USER_BLOCKED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  
  // Chat
  CHAT_NOT_FOUND: 'CHAT_NOT_FOUND',
  CHAT_ACCESS_DENIED: 'CHAT_ACCESS_DENIED',
  
  // Message
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  MESSAGE_EDIT_TIME_EXPIRED: 'MESSAGE_EDIT_TIME_EXPIRED',
  
  // File Upload
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // General
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHORIZED: 'UNAUTHORIZED'
} as const;

// Success Messages
export const SUCCESS_MESSAGES = {
  OTP_SENT: 'OTP sent successfully',
  OTP_VERIFIED: 'OTP verified successfully',
  USER_CREATED: 'User created successfully',
  USER_UPDATED: 'User updated successfully',
  MESSAGE_SENT: 'Message sent successfully',
  MESSAGE_UPDATED: 'Message updated successfully',
  MESSAGE_DELETED: 'Message deleted successfully',
  FILE_UPLOADED: 'File uploaded successfully',
  CALL_INITIATED: 'Call initiated successfully',
  STATUS_CREATED: 'Status created successfully'
} as const;

// Regex Patterns
export const REGEX_PATTERNS = {
  PHONE_NUMBER: /^\+?[1-9]\d{1,14}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  USERNAME: /^[a-zA-Z0-9._]{3,30}$/,
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  OTP: /^\d{6}$/,
  HEX_COLOR: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
} as const;

// Time Constants (in milliseconds)
export const TIME_CONSTANTS = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000
} as const;

// Default Values
export const DEFAULTS = {
  USER_ABOUT: 'Available',
  GROUP_MAX_MEMBERS: 256,
  STATUS_EXPIRY_HOURS: 24,
  MESSAGE_EDIT_TIME_LIMIT: 15 * 60 * 1000, // 15 minutes
  TYPING_TIMEOUT: 3000, // 3 seconds
  ONLINE_TIMEOUT: 30000, // 30 seconds
  PAGINATION_LIMIT: 20,
  MEDIA_COMPRESSION_QUALITY: 80
} as const;
