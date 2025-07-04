import { z } from 'zod';
import { REGEX_PATTERNS, OTP_CONFIG, JWT_CONFIG } from '@/lib/utils/constants';

// Phone number validation
export const phoneNumberSchema = z.object({
  phoneNumber: z.string()
    .regex(REGEX_PATTERNS.PHONE_NUMBER, 'Invalid phone number format')
    .min(10, 'Phone number too short')
    .max(15, 'Phone number too long'),
  countryCode: z.string()
    .min(1, 'Country code required')
    .max(4, 'Country code too long')
    .regex(/^\+?\d{1,4}$/, 'Invalid country code format')
});

// OTP validation
export const otpSchema = z.object({
  otp: z.string()
    .length(OTP_CONFIG.LENGTH, `OTP must be ${OTP_CONFIG.LENGTH} digits`)
    .regex(REGEX_PATTERNS.OTP, 'OTP must contain only digits')
});

// Registration schema
export const registerSchema = z.object({
  method: z.enum(['phone', 'email']),
  
  // Phone registration
  phoneNumber: z.string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Invalid phone number format')
    .optional(),
  countryCode: z.string()
    .min(1, 'Country code required')
    .max(4, 'Country code too long')
    .optional(),
    
  // Email registration
  email: z.string()
    .email('Invalid email format')
    .optional(),
    
  // Common fields
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(50, 'Display name must be less than 50 characters')
    .trim(),
  username: z.string()
    .regex(/^[a-zA-Z0-9._]{3,30}$/, 'Username must be 3-30 characters, letters, numbers, dots and underscores only')
    .optional()
}).refine((data) => {
  if (data.method === 'phone') {
    return data.phoneNumber && data.countryCode;
  } else if (data.method === 'email') {
    return data.email;
  }
  return false;
}, {
  message: 'Phone and country code required for phone method, email required for email method'
});
// Login schema
export const loginSchema = phoneNumberSchema.merge(otpSchema);

// Send OTP schema
export const sendOTPSchema = z.object({
  // Method selection
  method: z.enum(['phone', 'email'], {
    errorMap: () => ({ message: 'Authentication method must be either phone or email' })
  }),
  
  // Phone fields (required if method is phone)
  phoneNumber: z.string()
    .regex(/^\+[1-9]\d{1,14}$/, 'Invalid phone number format')
    .optional(),
  countryCode: z.string()
    .min(1, 'Country code required')
    .max(4, 'Country code too long')
    .optional(),
    
  // Email field (required if method is email)
  email: z.string()
    .email('Invalid email format')
    .optional()
}).refine((data) => {
  // Validate based on selected method
  if (data.method === 'phone') {
    return data.phoneNumber && data.countryCode;
  } else if (data.method === 'email') {
    return data.email;
  }
  return false;
}, {
  message: 'Phone number and country code required for phone method, email required for email method'
});

// Verify OTP schema
export const verifyOTPSchema = z.object({
  method: z.enum(['phone', 'email']),
  identifier: z.string().min(1, 'Identifier required'), // phone number or email
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^\d{6}$/, 'OTP must contain only digits'),
  userId: z.string().min(1, 'User ID required')
});


// Resend OTP schema
export const resendOTPSchema = z.object({
  phoneNumber: z.string()
    .regex(REGEX_PATTERNS.PHONE_NUMBER, 'Invalid phone number format'),
  countryCode: z.string()
    .min(1, 'Country code required')
    .max(4, 'Country code too long')
});

// Device info schema
export const deviceInfoSchema = z.object({
  deviceId: z.string()
    .min(1, 'Device ID required')
    .max(100, 'Device ID too long'),
  deviceName: z.string()
    .min(1, 'Device name required')
    .max(100, 'Device name too long'),
  platform: z.enum(['android', 'ios', 'web', 'desktop'], {
    errorMap: () => ({ message: 'Invalid platform' })
  }),
  appVersion: z.string()
    .min(1, 'App version required')
    .max(20, 'App version too long'),
  pushToken: z.string()
    .max(500, 'Push token too long')
    .optional()
});

// QR login schema
export const qrLoginSchema = z.object({
  qrToken: z.string()
    .min(1, 'QR token required'),
  deviceInfo: deviceInfoSchema
});

// Refresh token schema
export const refreshTokenSchema = z.object({
  refreshToken: z.string()
    .min(1, 'Refresh token required')
});

// Change password schema
export const changePasswordSchema = z.object({
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

// Reset password schema
export const resetPasswordSchema = z.object({
  phoneNumber: z.string()
    .regex(REGEX_PATTERNS.PHONE_NUMBER, 'Invalid phone number format'),
  otp: z.string()
    .length(OTP_CONFIG.LENGTH, `OTP must be ${OTP_CONFIG.LENGTH} digits`),
  newPassword: z.string()
    .regex(REGEX_PATTERNS.PASSWORD, 'Password must be at least 8 characters with uppercase, lowercase, number and special character')
});

// Two-factor authentication setup
export const twoFactorSetupSchema = z.object({
  secret: z.string()
    .min(1, 'Secret required'),
  token: z.string()
    .length(6, 'Token must be 6 digits')
    .regex(/^\d{6}$/, 'Token must contain only digits')
});