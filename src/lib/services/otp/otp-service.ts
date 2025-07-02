// ==============================================
// COMPLETE OTP SERVICE IMPLEMENTATION
// Phone & Email Authentication System
// ==============================================

// File: src/lib/services/otp/otp-service.ts

import { connectDB } from '@/lib/db/connection';
import User, { IUser } from '@/lib/db/models/User';
import { analyticsTracker } from '../analytics/tracker';
import { emailService } from '../email/sendEmail';
import { OTPStore } from './otp-store';
import { OTPRateLimiter } from './rate-limiter';
import { EncryptionService } from '@/lib/utils/encryption';
import { OTP_CONFIG, ERROR_CODES, SUCCESS_MESSAGES } from '@/lib/utils/constants';
import mongoose from 'mongoose';
import { twilioSMSService } from '../sms/twilio';

// ==============================================
// INTERFACES AND TYPES
// ==============================================

export interface OTPGenerationResult {
  success: boolean;
  otpId?: string;
  expiresAt?: Date;
  error?: string;
  cooldownSeconds?: number;
}

export interface OTPValidationResult {
  success: boolean;
  userId?: string;
  isNewUser?: boolean;
  attemptsRemaining?: number;
  error?: string;
  lockedUntil?: Date;
}

export interface OTPOptions {
  length?: number;
  expiryMinutes?: number;
  maxAttempts?: number;
  resendCooldownSeconds?: number;
  type?: 'numeric' | 'alphanumeric';
}

export interface OTPDeliveryInfo {
  method: 'phone' | 'email';
  phoneNumber?: string;
  countryCode?: string;
  email?: string;
  userName?: string;
}

export interface OTPGenerationOptions extends OTPOptions {
  method: 'phone' | 'email';
}

export interface OTPStatusInfo {
  hasActiveOTP: boolean;
  method?: 'phone' | 'email';
  identifier?: string;
  expiresAt?: Date;
  attemptsRemaining?: number;
  deliveryMethod?: string;
}

// ==============================================
// MAIN OTP SERVICE CLASS
// ==============================================

export class OTPService {
  private static instance: OTPService;
  private otpStore: OTPStore;
  private rateLimiter: OTPRateLimiter;

  private constructor() {
    this.otpStore = OTPStore.getInstance();
    this.rateLimiter = OTPRateLimiter.getInstance();
  }

  static getInstance(): OTPService {
    if (!OTPService.instance) {
      OTPService.instance = new OTPService();
    }
    return OTPService.instance;
  }

  // ==============================================
  // MAIN OTP GENERATION METHOD
  // ==============================================

  async generateOTP(
    identifier: string, // phone number or email
    method: 'phone' | 'email',
    deliveryInfo: OTPDeliveryInfo,
    options: OTPGenerationOptions
  ): Promise<OTPGenerationResult> {
    try {
      // Apply default options
      const otpOptions: Required<OTPOptions> = {
        length: options.length || OTP_CONFIG.LENGTH,
        expiryMinutes: options.expiryMinutes || OTP_CONFIG.EXPIRY_MINUTES,
        maxAttempts: options.maxAttempts || OTP_CONFIG.MAX_ATTEMPTS,
        resendCooldownSeconds: options.resendCooldownSeconds || OTP_CONFIG.RESEND_COOLDOWN_SECONDS,
        type: options.type || 'numeric'
      };

      // Validate input based on method
      const validationResult = this.validateInput(identifier, method, deliveryInfo);
      if (!validationResult.isValid) {
        return {
          success: false,
          error: validationResult.error
        };
      }

      // Check rate limiting
      const rateLimitResult = await this.rateLimiter.checkGenerationLimit(
        identifier,
        method
      );

      if (!rateLimitResult.allowed) {
        await analyticsTracker.trackFeatureUsage(
          'system',
          'otp',
          'generation_rate_limited',
          { 
            identifier: this.maskIdentifier(identifier, method),
            method,
            cooldownSeconds: rateLimitResult.cooldownSeconds
          }
        );

        return {
          success: false,
          error: ERROR_CODES.RATE_LIMIT_EXCEEDED,
          cooldownSeconds: rateLimitResult.cooldownSeconds
        };
      }

      // Generate OTP code
      const otpCode = this.generateOTPCode(otpOptions.length, otpOptions.type);
      const expiresAt = new Date(Date.now() + otpOptions.expiryMinutes * 60 * 1000);

      // Store OTP
      const storeResult = await this.otpStore.storeOTP(
        identifier,
        method,
        otpCode,
        expiresAt,
        otpOptions.maxAttempts,
        deliveryInfo
      );

      if (!storeResult.success) {
        return {
          success: false,
          error: storeResult.error
        };
      }

      // Update user temporary OTP (if user exists)
      await this.updateUserTempOTP(identifier, method, otpCode, expiresAt);

      // Send OTP via specified method
      const deliveryResult = await this.deliverOTP(
        otpCode,
        deliveryInfo,
        method
      );

      if (!deliveryResult.success) {
        // Mark OTP as failed delivery
        await this.otpStore.markOTPDeliveryFailed(storeResult.otpId!, deliveryResult.error || 'Unknown delivery error');
        
        return {
          success: false,
          error: `Failed to send OTP: ${deliveryResult.error}`
        };
      }

      // Track successful generation
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp',
        'generated',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          deliveryMethod: method,
          length: otpOptions.length,
          expiryMinutes: otpOptions.expiryMinutes
        }
      );

      return {
        success: true,
        otpId: storeResult.otpId,
        expiresAt
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_service',
        action: 'generate_otp',
        method,
        identifier: this.maskIdentifier(identifier, method)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // ==============================================
  // OTP VALIDATION METHOD
  // ==============================================

  async validateOTP(
    identifier: string,
    method: 'phone' | 'email',
    otpCode: string,
    options: { deleteOnSuccess?: boolean; userId?: string } = {}
  ): Promise<OTPValidationResult> {
    try {
      // Get stored OTP
      const storedOTP = await this.otpStore.getOTP(identifier, method);
      
      if (!storedOTP) {
        return {
          success: false,
          error: ERROR_CODES.INVALID_OTP
        };
      }

      // Check if OTP has expired
      if (storedOTP.isExpired || new Date() > storedOTP.expiresAt) {
        await this.otpStore.deleteOTP(identifier, method);
        
        await analyticsTracker.trackFeatureUsage(
          options.userId || 'system',
          'otp',
          'validation_failed',
          {
            identifier: this.maskIdentifier(identifier, method),
            method,
            reason: 'expired'
          }
        );

        return {
          success: false,
          error: ERROR_CODES.OTP_EXPIRED
        };
      }

      // Check if too many attempts
      if (storedOTP.attempts >= storedOTP.maxAttempts) {
        await this.otpStore.deleteOTP(identifier, method);
        
        await analyticsTracker.trackFeatureUsage(
          options.userId || 'system',
          'otp',
          'validation_failed',
          {
            identifier: this.maskIdentifier(identifier, method),
            method,
            reason: 'max_attempts_exceeded'
          }
        );

        return {
          success: false,
          error: ERROR_CODES.OTP_MAX_ATTEMPTS
        };
      }

      // Increment attempt count
      await this.otpStore.incrementAttempts(identifier, method);

      // Verify OTP code with timing-safe comparison
      const isValid = await this.verifyOTPCode(storedOTP.code, otpCode);
      
      if (!isValid) {
        const attemptsRemaining = storedOTP.maxAttempts - (storedOTP.attempts + 1);
        
        await analyticsTracker.trackFeatureUsage(
          options.userId || 'system',
          'otp',
          'validation_failed',
          {
            identifier: this.maskIdentifier(identifier, method),
            method,
            reason: 'invalid_code',
            attemptsRemaining
          }
        );

        return {
          success: false,
          error: ERROR_CODES.INVALID_OTP,
          attemptsRemaining
        };
      }

      // OTP is valid - mark as used if requested
      if (options.deleteOnSuccess) {
        await this.otpStore.markOTPAsUsed(identifier, method);
      }

      // Clear user temporary OTP
      await this.clearUserTempOTP(identifier, method);

      // Check if this is a new user registration
      const existingUser = await this.findUserByIdentifier(identifier, method);
      const isNewUser = !existingUser;

      // Track successful validation
      await analyticsTracker.trackFeatureUsage(
        existingUser?._id.toString() || 'system',
        'otp',
        'validation_success',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          isNewUser,
          deliveryMethod: storedOTP.deliveryMethod
        }
      );

      return {
        success: true,
        userId: existingUser?._id.toString(),
        isNewUser
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, options.userId || 'system', {
        component: 'otp_service',
        action: 'validate_otp',
        method,
        identifier: this.maskIdentifier(identifier, method)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // ==============================================
  // RESEND OTP METHOD
  // ==============================================

  async resendOTP(
    identifier: string,
    method: 'phone' | 'email'
  ): Promise<OTPGenerationResult> {
    try {
      // Get existing OTP
      const existingOTP = await this.otpStore.getOTP(identifier, method);
      if (!existingOTP) {
        return {
          success: false,
          error: 'No active OTP found for this identifier'
        };
      }

      // Check resend rate limiting
      const resendAllowed = await this.rateLimiter.checkResendLimit(identifier, method);
      if (!resendAllowed.allowed) {
        return {
          success: false,
          error: 'Please wait before requesting another OTP',
          cooldownSeconds: resendAllowed.cooldownSeconds
        };
      }

      // Send OTP with same delivery info
      const deliveryResult = await this.deliverOTP(
        existingOTP.code,
        existingOTP.deliveryInfo,
        method
      );

      if (!deliveryResult.success) {
        return {
          success: false,
          error: `Failed to resend OTP: ${deliveryResult.error}`
        };
      }

      // Update resend count
      await this.otpStore.updateOTPResendCount(identifier, method);

      // Track resend
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp',
        'resent',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          deliveryMethod: method
        }
      );

      return {
        success: true,
        otpId: existingOTP.id,
        expiresAt: existingOTP.expiresAt
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_service',
        action: 'resend_otp',
        method,
        identifier: this.maskIdentifier(identifier, method)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // ==============================================
  // GET OTP STATUS METHOD
  // ==============================================

  async getOTPStatus(identifier: string, method: 'phone' | 'email'): Promise<OTPStatusInfo> {
    try {
      const otp = await this.otpStore.getOTP(identifier, method);
      
      if (!otp || otp.isExpired || otp.isUsed) {
        return { hasActiveOTP: false };
      }

      return {
        hasActiveOTP: true,
        method,
        identifier: this.maskIdentifier(identifier, method),
        expiresAt: otp.expiresAt,
        attemptsRemaining: otp.maxAttempts - otp.attempts,
        deliveryMethod: method
      };
    } catch (error) {
      return { hasActiveOTP: false };
    }
  }

  // ==============================================
  // CANCEL OTP METHOD
  // ==============================================

  async cancelOTP(identifier: string, method: 'phone' | 'email', reason?: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await this.otpStore.deleteOTP(identifier, method);
      await this.clearUserTempOTP(identifier, method);

      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp',
        'cancelled',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          reason: reason || 'user_request'
        }
      );

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ==============================================
  // PRIVATE HELPER METHODS
  // ==============================================

  // Validate input based on method
  private validateInput(identifier: string, method: 'phone' | 'email', deliveryInfo: OTPDeliveryInfo): {
    isValid: boolean;
    error?: string;
  } {
    if (method === 'phone') {
      if (!identifier || !deliveryInfo.phoneNumber || !deliveryInfo.countryCode) {
        return {
          isValid: false,
          error: 'Phone number and country code required for phone method'
        };
      }
      
      // Validate phone number format
      const phoneRegex = /^\+[1-9]\d{1,14}$/;
      if (!phoneRegex.test(identifier)) {
        return {
          isValid: false,
          error: 'Invalid phone number format'
        };
      }
    } else if (method === 'email') {
      if (!identifier || !deliveryInfo.email) {
        return {
          isValid: false,
          error: 'Email address required for email method'
        };
      }
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(identifier)) {
        return {
          isValid: false,
          error: 'Invalid email format'
        };
      }
    } else {
      return {
        isValid: false,
        error: 'Invalid authentication method'
      };
    }

    return { isValid: true };
  }

  // Generate OTP code
  private generateOTPCode(length: number, type: 'numeric' | 'alphanumeric'): string {
    if (type === 'numeric') {
      let otp = '';
      for (let i = 0; i < length; i++) {
        otp += Math.floor(Math.random() * 10).toString();
      }
      return otp;
    } else {
      // Alphanumeric (excluding similar characters like 0, O, 1, l, I)
      const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      let otp = '';
      for (let i = 0; i < length; i++) {
        otp += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return otp;
    }
  }

  // Verify OTP code with timing-safe comparison
  private async verifyOTPCode(storedCode: string, providedCode: string): Promise<boolean> {
    return EncryptionService.secureCompare(storedCode, providedCode);
  }

  // Deliver OTP via specified method
  private async deliverOTP(
    otpCode: string,
    deliveryInfo: OTPDeliveryInfo,
    method: 'phone' | 'email'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (method === 'phone') {
        return await this.deliverSMSOTP(otpCode, deliveryInfo);
      } else {
        return await this.deliverEmailOTP(otpCode, deliveryInfo);
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Deliver OTP via SMS
  private async deliverSMSOTP(otpCode: string, deliveryInfo: OTPDeliveryInfo): Promise<{ success: boolean; error?: string }> {
    try {
      if (twilioSMSService.isConfigured()) {
        const smsResult = await twilioSMSService.sendOTPSMS(
          deliveryInfo.phoneNumber!,
          otpCode,
          'WhatsApp Clone',
          OTP_CONFIG.EXPIRY_MINUTES
        );

        if (smsResult.success) {
          console.log(`✅ SMS OTP sent to ${this.maskPhoneNumber(deliveryInfo.phoneNumber!)} via Twilio`);
          
          await analyticsTracker.trackFeatureUsage(
            'system',
            'sms',
            'otp_sent',
            {
              phoneNumber: this.maskPhoneNumber(deliveryInfo.phoneNumber!),
              provider: 'twilio',
              messageId: smsResult.messageId
            }
          );

          return { success: true };
        } else {
          console.error(`❌ SMS OTP delivery failed: ${smsResult.error}`);
          
          await analyticsTracker.trackFeatureUsage(
            'system',
            'sms',
            'otp_failed',
            {
              phoneNumber: this.maskPhoneNumber(deliveryInfo.phoneNumber!),
              provider: 'twilio',
              error: smsResult.error
            }
          );

          return {
            success: false,
            error: smsResult.error
          };
        }
      } else {
        // Fallback: Log to console if Twilio is not configured
        console.log(`📱 SMS OTP (Console): ${deliveryInfo.phoneNumber} - Code: ${otpCode}`);
        console.log(`⚠️  Twilio is not configured. Enable it by setting TWILIO_ENABLED=true and adding your Twilio credentials to .env`);
        
        await analyticsTracker.trackFeatureUsage(
          'system',
          'sms',
          'otp_console',
          {
            phoneNumber: this.maskPhoneNumber(deliveryInfo.phoneNumber!),
            provider: 'console'
          }
        );

        return { success: true };
      }
    } catch (error: any) {
      console.error(`❌ SMS service error:`, error);
      
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_delivery',
        action: 'sms_delivery',
        phoneNumber: this.maskPhoneNumber(deliveryInfo.phoneNumber!)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Deliver OTP via Email
  private async deliverEmailOTP(otpCode: string, deliveryInfo: OTPDeliveryInfo): Promise<{ success: boolean; error?: string }> {
    try {
      const emailResult = await emailService.sendOTPEmail(
        deliveryInfo.email!,
        otpCode,
        deliveryInfo.userName || 'User',
        undefined // No phone number for email method
      );
      
      if (emailResult.success) {
        console.log(`✅ Email OTP sent to ${this.maskEmail(deliveryInfo.email!)}`);
        
        await analyticsTracker.trackFeatureUsage(
          'system',
          'email',
          'otp_sent',
          {
            email: this.maskEmail(deliveryInfo.email!),
            provider: 'email_service'
          }
        );

        return { success: true };
      } else {
        console.error(`❌ Email OTP delivery failed: ${emailResult.error}`);
        
        await analyticsTracker.trackFeatureUsage(
          'system',
          'email',
          'otp_failed',
          {
            email: this.maskEmail(deliveryInfo.email!),
            error: emailResult.error
          }
        );

        return {
          success: false,
          error: emailResult.error
        };
      }
    } catch (error: any) {
      console.error(`❌ Email service error:`, error);
      
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_delivery',
        action: 'email_delivery',
        email: this.maskEmail(deliveryInfo.email!)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Find user by identifier and method
  private async findUserByIdentifier(identifier: string, method: 'phone' | 'email'): Promise<IUser | null> {
    try {
      await connectDB();
      
      if (method === 'phone') {
        // For phone, we need to extract country code and phone number
        // Assuming identifier is the full phone number with country code
        return await User.findOne({ 
          $or: [
            { phoneNumber: identifier },
            { phoneNumber: identifier.replace(/^\+/, '') }
          ]
        });
      } else {
        return await User.findOne({ email: identifier });
      }
    } catch (error) {
      console.error('Error finding user by identifier:', error);
      return null;
    }
  }

  // Update user temporary OTP
  private async updateUserTempOTP(identifier: string, method: 'phone' | 'email', otpCode: string, expiresAt: Date): Promise<void> {
    try {
      await connectDB();
      
      const user = await this.findUserByIdentifier(identifier, method);
      if (user) {
        user.tempOTP = otpCode;
        user.tempOTPExpires = expiresAt;
        await user.save();
      }
    } catch (error) {
      console.error('Error updating user temp OTP:', error);
    }
  }

  // Clear user temporary OTP
  private async clearUserTempOTP(identifier: string, method: 'phone' | 'email'): Promise<void> {
    try {
      await connectDB();
      
      const user = await this.findUserByIdentifier(identifier, method);
      if (user) {
        user.tempOTP = undefined;
        user.tempOTPExpires = undefined;
        await user.save();
      }
    } catch (error) {
      console.error('Error clearing user temp OTP:', error);
    }
  }

  // Mask identifier for logging
  private maskIdentifier(identifier: string, method: 'phone' | 'email'): string {
    if (method === 'phone') {
      return this.maskPhoneNumber(identifier);
    } else {
      return this.maskEmail(identifier);
    }
  }

  // Mask phone number for logging
  public maskPhoneNumber(phoneNumber: string): string {
    if (phoneNumber.length <= 4) return phoneNumber;
    const visibleDigits = 2;
    const start = phoneNumber.substring(0, visibleDigits + 1); // Include country code +
    const end = phoneNumber.substring(phoneNumber.length - visibleDigits);
    const masked = '*'.repeat(phoneNumber.length - (visibleDigits * 2) - 1);
    return `${start}${masked}${end}`;
  }

  // Mask email for logging
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (local.length <= 3) {
      return `${local[0]}***@${domain}`;
    }
    const maskedLocal = local.substring(0, 3) + '*'.repeat(Math.max(0, local.length - 3));
    return `${maskedLocal}@${domain}`;
  }

  // ==============================================
  // BULK OPERATIONS AND UTILITIES
  // ==============================================

  // Get OTP statistics
  async getOTPStatistics(): Promise<{
    activeCount: number;
    expiredCount: number;
    usedCount: number;
    dailyGenerated: number;
    dailyValidated: number;
    methodBreakdown: {
      phone: { active: number; used: number };
      email: { active: number; used: number };
    };
  }> {
    try {
      return await this.otpStore.getOTPStatistics();
    } catch (error) {
      console.error('Error getting OTP statistics:', error);
      return {
        activeCount: 0,
        expiredCount: 0,
        usedCount: 0,
        dailyGenerated: 0,
        dailyValidated: 0,
        methodBreakdown: {
          phone: { active: 0, used: 0 },
          email: { active: 0, used: 0 }
        }
      };
    }
  }

  // Cleanup expired OTPs
  async cleanupExpiredOTPs(): Promise<{
    deleted: number;
    errors: number;
  }> {
    try {
      return await this.otpStore.cleanupExpiredOTPs();
    } catch (error) {
      console.error('Error cleaning up expired OTPs:', error);
      return { deleted: 0, errors: 1 };
    }
  }

  // Health check
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    services: {
      sms: 'healthy' | 'unhealthy' | 'not_configured';
      email: 'healthy' | 'unhealthy';
      database: 'healthy' | 'unhealthy';
      rateLimiter: 'healthy' | 'unhealthy';
    };
    stats: {
      activeOTPs: number;
      todayGenerated: number;
    };
  }> {
    try {
      const stats = await this.getOTPStatistics();
      
      // Check SMS service
      let smsStatus: 'healthy' | 'unhealthy' | 'not_configured' = 'not_configured';
      if (twilioSMSService.isConfigured()) {
        smsStatus = 'healthy'; // Could add actual Twilio API test here
      }

      // Check email service
      let emailStatus: 'healthy' | 'unhealthy' = 'healthy'; // Could add actual email test here

      // Check database
      let dbStatus: 'healthy' | 'unhealthy' = 'healthy';
      try {
        await connectDB();
      } catch {
        dbStatus = 'unhealthy';
      }

      // Check rate limiter
      let rateLimiterStatus: 'healthy' | 'unhealthy' = 'healthy'; // Could add rate limiter test

      const allHealthy = [smsStatus, emailStatus, dbStatus, rateLimiterStatus].every(
        status => status === 'healthy' || status === 'not_configured'
      );

      return {
        status: allHealthy ? 'healthy' : 'unhealthy',
        services: {
          sms: smsStatus,
          email: emailStatus,
          database: dbStatus,
          rateLimiter: rateLimiterStatus
        },
        stats: {
          activeOTPs: stats.activeCount,
          todayGenerated: stats.dailyGenerated
        }
      };
    } catch (error) {
      console.error('OTP Service health check failed:', error);
      return {
        status: 'unhealthy',
        services: {
          sms: 'unhealthy',
          email: 'unhealthy',
          database: 'unhealthy',
          rateLimiter: 'unhealthy'
        },
        stats: {
          activeOTPs: 0,
          todayGenerated: 0
        }
      };
    }
  }
}

// ==============================================
// EXPORT SINGLETON INSTANCE
// ==============================================

export const otpService = OTPService.getInstance();
