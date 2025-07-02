import { OTPStore } from './otp-store';
import { OTPRateLimiter } from './rate-limiter';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { analyticsTracker } from '../analytics/tracker';
import { emailService } from '../email/sendEmail';
import { OTP_CONFIG, ERROR_CODES, SUCCESS_MESSAGES } from '@/lib/utils/constants';
import { EncryptionService } from '@/lib/utils/encryption';

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
  deliveryMethod?: 'sms' | 'email' | 'both';
}

export interface OTPDeliveryInfo {
  phoneNumber: string;
  countryCode: string;
  email?: string;
  userName?: string;
}

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

  // Generate and send OTP for phone verification
  async generateOTP(
    phoneNumber: string,
    countryCode: string,
    deliveryInfo: OTPDeliveryInfo,
    options: OTPOptions = {}
  ): Promise<OTPGenerationResult> {
    try {
      // Apply default options
      const otpOptions: Required<OTPOptions> = {
        length: options.length || OTP_CONFIG.LENGTH,
        expiryMinutes: options.expiryMinutes || OTP_CONFIG.EXPIRY_MINUTES,
        maxAttempts: options.maxAttempts || OTP_CONFIG.MAX_ATTEMPTS,
        resendCooldownSeconds: options.resendCooldownSeconds || OTP_CONFIG.RESEND_COOLDOWN_SECONDS,
        type: options.type || 'numeric',
        deliveryMethod: options.deliveryMethod || 'sms'
      };

      // Check rate limiting
      const rateLimitResult = await this.rateLimiter.checkGenerationLimit(
        phoneNumber,
        deliveryInfo.email
      );

      if (!rateLimitResult.allowed) {
        await analyticsTracker.trackFeatureUsage(
          'system',
          'otp',
          'generation_rate_limited',
          { 
            phoneNumber: this.maskPhoneNumber(phoneNumber),
            cooldownSeconds: rateLimitResult.cooldownSeconds
          }
        );

        return {
          success: false,
          error: ERROR_CODES.RATE_LIMIT_EXCEEDED,
          cooldownSeconds: rateLimitResult.cooldownSeconds
        };
      }

      // Check if there's an active OTP for this phone number
      const existingOTP = await this.otpStore.getOTP(phoneNumber);
      if (existingOTP && !existingOTP.isExpired && !existingOTP.isUsed) {
        const resendAllowed = await this.rateLimiter.checkResendLimit(phoneNumber);
        
        if (!resendAllowed.allowed) {
          return {
            success: false,
            error: 'Please wait before requesting another OTP',
            cooldownSeconds: resendAllowed.cooldownSeconds
          };
        }
      }

      // Generate OTP code
      const otpCode = this.generateOTPCode(otpOptions.length, otpOptions.type);
      const expiresAt = new Date(Date.now() + otpOptions.expiryMinutes * 60 * 1000);

      // Store OTP
      const storeResult = await this.otpStore.storeOTP({
        phoneNumber,
        countryCode,
        code: otpCode,
        expiresAt,
        maxAttempts: otpOptions.maxAttempts,
        deliveryMethod: otpOptions.deliveryMethod,
        deliveryInfo
      });

      if (!storeResult.success) {
        return {
          success: false,
          error: storeResult.error
        };
      }

      // Update user with temporary OTP (for backward compatibility)
      await this.updateUserTempOTP(phoneNumber, countryCode, otpCode, expiresAt);

      // Send OTP via specified delivery method
      const deliveryResult = await this.deliverOTP(
        otpCode,
        deliveryInfo,
        otpOptions.deliveryMethod
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
          phoneNumber: this.maskPhoneNumber(phoneNumber),
          deliveryMethod: otpOptions.deliveryMethod,
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
        phoneNumber: this.maskPhoneNumber(phoneNumber)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Validate OTP code
  async validateOTP(
    phoneNumber: string,
    otpCode: string,
    options: { 
      deleteOnSuccess?: boolean;
      userId?: string;
    } = {}
  ): Promise<OTPValidationResult> {
    try {
      const deleteOnSuccess = options.deleteOnSuccess !== false; // Default to true

      // Check rate limiting for validation attempts
      const rateLimitResult = await this.rateLimiter.checkValidationLimit(phoneNumber);
      if (!rateLimitResult.allowed) {
        await analyticsTracker.trackFeatureUsage(
          options.userId || 'system',
          'otp',
          'validation_rate_limited',
          {
            phoneNumber: this.maskPhoneNumber(phoneNumber),
            lockedUntil: rateLimitResult.lockedUntil
          }
        );

        return {
          success: false,
          error: ERROR_CODES.RATE_LIMIT_EXCEEDED,
          lockedUntil: rateLimitResult.lockedUntil
        };
      }

      // Get stored OTP
      const storedOTP = await this.otpStore.getOTP(phoneNumber);
      if (!storedOTP) {
        await analyticsTracker.trackFeatureUsage(
          options.userId || 'system',
          'otp',
          'validation_failed',
          {
            phoneNumber: this.maskPhoneNumber(phoneNumber),
            reason: 'otp_not_found'
          }
        );

        return {
          success: false,
          error: ERROR_CODES.INVALID_OTP
        };
      }

      // Check if OTP is expired
      if (storedOTP.isExpired) {
        await this.otpStore.deleteOTP(phoneNumber);
        
        await analyticsTracker.trackFeatureUsage(
          options.userId || 'system',
          'otp',
          'validation_failed',
          {
            phoneNumber: this.maskPhoneNumber(phoneNumber),
            reason: 'expired'
          }
        );

        return {
          success: false,
          error: ERROR_CODES.OTP_EXPIRED
        };
      }

      // Check if OTP is already used
      if (storedOTP.isUsed) {
        await analyticsTracker.trackFeatureUsage(
          options.userId || 'system',
          'otp',
          'validation_failed',
          {
            phoneNumber: this.maskPhoneNumber(phoneNumber),
            reason: 'already_used'
          }
        );

        return {
          success: false,
          error: ERROR_CODES.INVALID_OTP
        };
      }

      // Check if max attempts exceeded
      if (storedOTP.attempts >= storedOTP.maxAttempts) {
        await this.otpStore.markOTPAsUsed(phoneNumber);
        
        await analyticsTracker.trackFeatureUsage(
          options.userId || 'system',
          'otp',
          'validation_failed',
          {
            phoneNumber: this.maskPhoneNumber(phoneNumber),
            reason: 'max_attempts_exceeded'
          }
        );

        return {
          success: false,
          error: ERROR_CODES.OTP_MAX_ATTEMPTS,
          attemptsRemaining: 0
        };
      }

      // Validate OTP code
      const isValidCode = await this.verifyOTPCode(storedOTP.code, otpCode);
      
      // Increment attempts
      await this.otpStore.incrementOTPAttempts(phoneNumber);

      if (!isValidCode) {
        const attemptsRemaining = storedOTP.maxAttempts - (storedOTP.attempts + 1);
        
        await analyticsTracker.trackFeatureUsage(
          options.userId || 'system',
          'otp',
          'validation_failed',
          {
            phoneNumber: this.maskPhoneNumber(phoneNumber),
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
      if (deleteOnSuccess) {
        await this.otpStore.markOTPAsUsed(phoneNumber);
      }

      // Clear user temporary OTP
      await this.clearUserTempOTP(phoneNumber);

      // Check if this is a new user registration
      const existingUser = await this.findUserByPhone(phoneNumber);
      const isNewUser = !existingUser;

      // Track successful validation
      await analyticsTracker.trackFeatureUsage(
        existingUser?._id.toString() || 'system',
        'otp',
        'validation_success',
        {
          phoneNumber: this.maskPhoneNumber(phoneNumber),
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
        phoneNumber: this.maskPhoneNumber(phoneNumber)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Resend OTP with same or different delivery method
  async resendOTP(
    phoneNumber: string,
    deliveryMethod?: 'sms' | 'email' | 'both'
  ): Promise<OTPGenerationResult> {
    try {
      // Get existing OTP
      const existingOTP = await this.otpStore.getOTP(phoneNumber);
      if (!existingOTP) {
        return {
          success: false,
          error: 'No active OTP found for this phone number'
        };
      }

      // Check resend rate limiting
      const resendAllowed = await this.rateLimiter.checkResendLimit(phoneNumber);
      if (!resendAllowed.allowed) {
        return {
          success: false,
          error: 'Please wait before requesting another OTP',
          cooldownSeconds: resendAllowed.cooldownSeconds
        };
      }

      // Use specified delivery method or fallback to original
      const targetDeliveryMethod = deliveryMethod || existingOTP.deliveryMethod;

      // Send OTP with new delivery method
      const deliveryResult = await this.deliverOTP(
        existingOTP.code,
        existingOTP.deliveryInfo,
        targetDeliveryMethod
      );

      if (!deliveryResult.success) {
        return {
          success: false,
          error: `Failed to resend OTP: ${deliveryResult.error}`
        };
      }

      // Update delivery method and resend count
      await this.otpStore.updateOTPDeliveryMethod(phoneNumber, targetDeliveryMethod);

      // Track resend
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp',
        'resent',
        {
          phoneNumber: this.maskPhoneNumber(phoneNumber),
          deliveryMethod: targetDeliveryMethod,
          originalDeliveryMethod: existingOTP.deliveryMethod
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
        phoneNumber: this.maskPhoneNumber(phoneNumber)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Cancel active OTP
  async cancelOTP(phoneNumber: string, reason?: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await this.otpStore.deleteOTP(phoneNumber);
      await this.clearUserTempOTP(phoneNumber);

      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp',
        'cancelled',
        {
          phoneNumber: this.maskPhoneNumber(phoneNumber),
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

  // Get OTP status
  async getOTPStatus(phoneNumber: string): Promise<{
    hasActiveOTP: boolean;
    expiresAt?: Date;
    attemptsRemaining?: number;
    deliveryMethod?: string;
  }> {
    try {
      const otp = await this.otpStore.getOTP(phoneNumber);
      
      if (!otp || otp.isExpired || otp.isUsed) {
        return { hasActiveOTP: false };
      }

      return {
        hasActiveOTP: true,
        expiresAt: otp.expiresAt,
        attemptsRemaining: otp.maxAttempts - otp.attempts,
        deliveryMethod: otp.deliveryMethod
      };
    } catch (error) {
      return { hasActiveOTP: false };
    }
  }

  // Private helper methods

  // Generate OTP code
  private generateOTPCode(length: number, type: 'numeric' | 'alphanumeric'): string {
    if (type === 'numeric') {
      let otp = '';
      for (let i = 0; i < length; i++) {
        otp += Math.floor(Math.random() * 10).toString();
      }
      return otp;
    } else {
      // Alphanumeric (excluding similar characters)
      const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
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
    method: 'sms' | 'email' | 'both'
  ): Promise<{ success: boolean; error?: string }> {
    const results: { sms?: boolean; email?: boolean } = {};

    try {
      if (method === 'sms' || method === 'both') {
        // SMS delivery would be implemented here
        // For now, simulate success
        results.sms = true;
        console.log(`SMS OTP sent to ${deliveryInfo.phoneNumber}: ${otpCode}`);
      }

      if (method === 'email' || method === 'both') {
        if (deliveryInfo.email) {
          const emailResult = await emailService.sendOTPEmail(
            deliveryInfo.email,
            otpCode,
            deliveryInfo.userName || 'User',
            deliveryInfo.phoneNumber
          );
          results.email = emailResult.success;
        } else {
          results.email = false;
        }
      }

      // Check if at least one delivery method succeeded
      const hasSuccess = Object.values(results).some(result => result === true);
      
      if (!hasSuccess) {
        return {
          success: false,
          error: 'All delivery methods failed'
        };
      }

      return { success: true };

    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Update user temporary OTP (backward compatibility)
  private async updateUserTempOTP(
    phoneNumber: string,
    countryCode: string,
    otpCode: string,
    expiresAt: Date
  ): Promise<void> {
    try {
      await connectDB();

      await User.findOneAndUpdate(
        { phoneNumber, countryCode },
        {
          tempOTP: otpCode,
          tempOTPExpires: expiresAt
        },
        { upsert: false }
      );
    } catch (error) {
      console.error('Error updating user temp OTP:', error);
    }
  }

  // Clear user temporary OTP
  private async clearUserTempOTP(phoneNumber: string): Promise<void> {
    try {
      await connectDB();

      await User.updateMany(
        { phoneNumber },
        {
          $unset: {
            tempOTP: 1,
            tempOTPExpires: 1
          }
        }
      );
    } catch (error) {
      console.error('Error clearing user temp OTP:', error);
    }
  }

  // Find user by phone number
  private async findUserByPhone(phoneNumber: string): Promise<any> {
    try {
      await connectDB();
      return await User.findOne({ phoneNumber }).lean();
    } catch (error) {
      console.error('Error finding user by phone:', error);
      return null;
    }
  }

  // Mask phone number for logging
  private maskPhoneNumber(phoneNumber: string): string {
    if (phoneNumber.length <= 4) return phoneNumber;
    const visibleDigits = 2;
    const start = phoneNumber.substring(0, visibleDigits);
    const end = phoneNumber.substring(phoneNumber.length - visibleDigits);
    const masked = '*'.repeat(phoneNumber.length - (visibleDigits * 2));
    return start + masked + end;
  }

  // Get OTP statistics
  async getOTPStatistics(): Promise<{
    activeOTPs: number;
    dailyGenerated: number;
    dailyValidated: number;
    successRate: number;
  }> {
    try {
      const stats = await this.otpStore.getStatistics();
      return {
        activeOTPs: stats.activeCount,
        dailyGenerated: stats.dailyGenerated,
        dailyValidated: stats.dailyValidated,
        successRate: stats.dailyGenerated > 0 ? 
          (stats.dailyValidated / stats.dailyGenerated) * 100 : 0
      };
    } catch (error) {
      console.error('Error getting OTP statistics:', error);
      return {
        activeOTPs: 0,
        dailyGenerated: 0,
        dailyValidated: 0,
        successRate: 0
      };
    }
  }
}

// Export singleton instance
export const otpService = OTPService.getInstance();