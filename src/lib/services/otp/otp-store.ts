// ==============================================
// COMPLETE OTP STORE IMPLEMENTATION
// Supports both Phone & Email Methods
// ==============================================

// File: src/lib/services/otp/otp-store.ts

import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import { analyticsTracker } from '../analytics/tracker';
import { EncryptionService } from '@/lib/utils/encryption';
import { TIME_CONSTANTS, OTP_CONFIG } from '@/lib/utils/constants';
import type { OTPDeliveryInfo } from './otp-service';

// ==============================================
// INTERFACES
// ==============================================

export interface StoredOTP {
  id: string;
  code: string;
  identifier: string; // phone number or email
  method: 'phone' | 'email';
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  isUsed: boolean;
  isExpired: boolean;
  createdAt: Date;
  usedAt?: Date;
  deliveryInfo: OTPDeliveryInfo;
  deliveryMethod: 'phone' | 'email';
  deliveryStatus: {
    sent: boolean;
    sentAt?: Date;
    error?: string;
    messageId?: string;
  };
  resendCount: number;
  lastResendAt?: Date;
}

export interface OTPStoreResult {
  success: boolean;
  otpId?: string;
  error?: string;
}

// ==============================================
// OTP STORE CLASS
// ==============================================

export class OTPStore {
  private static instance: OTPStore;
  private readonly OTP_CATEGORY = 'otp_verification';
  private readonly RETENTION_HOURS = 24; // Keep OTPs for 24 hours max

  private constructor() {
    // Initialize cleanup interval
    setInterval(() => {
      this.cleanupExpiredOTPs();
    }, TIME_CONSTANTS.HOUR); // Cleanup every hour
  }

  static getInstance(): OTPStore {
    if (!OTPStore.instance) {
      OTPStore.instance = new OTPStore();
    }
    return OTPStore.instance;
  }

  // ==============================================
  // MAIN STORE METHODS
  // ==============================================

  // Store OTP with method support
  async storeOTP(
    identifier: string,
    method: 'phone' | 'email',
    otpCode: string,
    expiresAt: Date,
    maxAttempts: number,
    deliveryInfo: OTPDeliveryInfo
  ): Promise<OTPStoreResult> {
    try {
      await connectDB();

      const otpId = this.generateOTPId();
      const otpKey = this.getOTPKey(identifier, method);

      const otpData = {
        id: otpId,
        code: otpCode,
        identifier,
        method,
        expiresAt,
        attempts: 0,
        maxAttempts,
        isUsed: false,
        isExpired: false,
        createdAt: new Date(),
        deliveryInfo,
        deliveryMethod: method,
        deliveryStatus: {
          sent: false
        },
        resendCount: 0
      };

      // Store in database
      await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY,
          key: otpKey
        },
        {
          category: this.OTP_CATEGORY,
          key: otpKey,
          value: otpData,
          type: 'object',
          description: `OTP for ${method}: ${this.maskIdentifier(identifier, method)}`,
          isPublic: false,
          expiresAt
        },
        { upsert: true, new: true }
      );

      // Track storage
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp_store',
        'otp_stored',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          otpId,
          expiryMinutes: Math.round((expiresAt.getTime() - Date.now()) / (1000 * 60))
        }
      );

      return {
        success: true,
        otpId
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_store',
        action: 'store_otp',
        method,
        identifier: this.maskIdentifier(identifier, method)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get stored OTP
  async getOTP(identifier: string, method: 'phone' | 'email'): Promise<StoredOTP | null> {
    try {
      await connectDB();

      const otpKey = this.getOTPKey(identifier, method);
      const setting = await Settings.findOne({
        category: this.OTP_CATEGORY,
        key: otpKey
      });

      if (!setting || !setting.value) {
        return null;
      }

      const otpData = setting.value;
      
      // Check if expired
      const now = new Date();
      const isExpired = now > new Date(otpData.expiresAt);

      return {
        ...otpData,
        expiresAt: new Date(otpData.expiresAt),
        createdAt: new Date(otpData.createdAt),
        usedAt: otpData.usedAt ? new Date(otpData.usedAt) : undefined,
        lastResendAt: otpData.lastResendAt ? new Date(otpData.lastResendAt) : undefined,
        isExpired
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_store',
        action: 'get_otp',
        method,
        identifier: this.maskIdentifier(identifier, method)
      });

      return null;
    }
  }

  // Mark OTP as used
  async markOTPAsUsed(identifier: string, method: 'phone' | 'email'): Promise<OTPStoreResult> {
    try {
      await connectDB();

      const otpKey = this.getOTPKey(identifier, method);
      const result = await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY,
          key: otpKey
        },
        {
          $set: {
            'value.isUsed': true,
            'value.usedAt': new Date()
          }
        },
        { new: true }
      );

      if (!result) {
        return {
          success: false,
          error: 'OTP not found'
        };
      }

      // Track usage
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp_store',
        'otp_used',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          otpId: result.value.id
        }
      );

      return { success: true };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_store',
        action: 'mark_otp_used',
        method,
        identifier: this.maskIdentifier(identifier, method)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Delete OTP
  async deleteOTP(identifier: string, method: 'phone' | 'email'): Promise<OTPStoreResult> {
    try {
      await connectDB();

      const otpKey = this.getOTPKey(identifier, method);
      const result = await Settings.findOneAndDelete({
        category: this.OTP_CATEGORY,
        key: otpKey
      });

      if (!result) {
        return {
          success: false,
          error: 'OTP not found'
        };
      }

      // Track deletion
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp_store',
        'otp_deleted',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          otpId: result.value?.id
        }
      );

      return { success: true };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_store',
        action: 'delete_otp',
        method,
        identifier: this.maskIdentifier(identifier, method)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Increment attempt count
  async incrementAttempts(identifier: string, method: 'phone' | 'email'): Promise<{
    success: boolean;
    attempts?: number;
    error?: string;
  }> {
    try {
      await connectDB();

      const otpKey = this.getOTPKey(identifier, method);
      const result = await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY,
          key: otpKey
        },
        {
          $inc: { 'value.attempts': 1 },
          $set: { 'value.lastAttemptAt': new Date() }
        },
        { new: true }
      );

      if (!result) {
        return {
          success: false,
          error: 'OTP not found'
        };
      }

      const attempts = result.value.attempts;

      // Track attempt
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp_store',
        'attempt_incremented',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          attempts,
          maxAttempts: result.value.maxAttempts
        }
      );

      return {
        success: true,
        attempts
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_store',
        action: 'increment_attempts',
        method,
        identifier: this.maskIdentifier(identifier, method)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Update delivery status
  async updateDeliveryStatus(
    identifier: string,
    method: 'phone' | 'email',
    status: {
      sent: boolean;
      sentAt?: Date;
      messageId?: string;
      error?: string;
    }
  ): Promise<OTPStoreResult> {
    try {
      await connectDB();

      const otpKey = this.getOTPKey(identifier, method);
      const result = await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY,
          key: otpKey
        },
        {
          $set: {
            'value.deliveryStatus': {
              ...status,
              sentAt: status.sentAt || new Date()
            }
          }
        },
        { new: true }
      );

      if (!result) {
        return {
          success: false,
          error: 'OTP not found'
        };
      }

      // Track delivery
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp_store',
        'delivery_status_updated',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          sent: status.sent,
          hasError: !!status.error
        }
      );

      return { success: true };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_store',
        action: 'update_delivery_status',
        method,
        identifier: this.maskIdentifier(identifier, method)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Mark delivery as failed
  async markOTPDeliveryFailed(otpId: string, error: string): Promise<OTPStoreResult> {
    try {
      await connectDB();

      const result = await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY,
          'value.id': otpId
        },
        {
          $set: {
            'value.deliveryStatus.sent': false,
            'value.deliveryStatus.error': error,
            'value.deliveryStatus.sentAt': new Date()
          }
        },
        { new: true }
      );

      if (!result) {
        return {
          success: false,
          error: 'OTP not found'
        };
      }

      // Track delivery failure
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp_store',
        'delivery_failed',
        {
          otpId,
          error: error.substring(0, 100),
          method: result.value.method
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

  // Update resend count
  async updateOTPResendCount(identifier: string, method: 'phone' | 'email'): Promise<OTPStoreResult> {
    try {
      await connectDB();

      const otpKey = this.getOTPKey(identifier, method);
      const result = await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY,
          key: otpKey
        },
        {
          $inc: { 'value.resendCount': 1 },
          $set: { 'value.lastResendAt': new Date() }
        },
        { new: true }
      );

      if (!result) {
        return {
          success: false,
          error: 'OTP not found'
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

  // ==============================================
  // STATISTICS AND MONITORING
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
      await connectDB();

      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);

      const otps = await Settings.find({
        category: this.OTP_CATEGORY
      }).lean();

      const stats = {
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

      otps.forEach(setting => {
        const otp = setting.value;
        const createdAt = new Date(otp.createdAt);
        const expiresAt = new Date(otp.expiresAt);

        // Count by status
        if (otp.isUsed) {
          stats.usedCount++;
          if (otp.usedAt && new Date(otp.usedAt) >= startOfDay) {
            stats.dailyValidated++;
          }
        } else if (now > expiresAt) {
          stats.expiredCount++;
        } else {
          stats.activeCount++;
        }

        // Daily generation count
        if (createdAt >= startOfDay) {
          stats.dailyGenerated++;
        }

        // Method breakdown
        if (otp.method === 'phone') {
          if (otp.isUsed) {
            stats.methodBreakdown.phone.used++;
          } else if (now <= expiresAt) {
            stats.methodBreakdown.phone.active++;
          }
        } else if (otp.method === 'email') {
          if (otp.isUsed) {
            stats.methodBreakdown.email.used++;
          } else if (now <= expiresAt) {
            stats.methodBreakdown.email.active++;
          }
        }
      });

      return stats;

    } catch (error: any) {
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
      await connectDB();

      const retentionCutoff = new Date(Date.now() - this.RETENTION_HOURS * TIME_CONSTANTS.HOUR);

      const result = await Settings.deleteMany({
        category: this.OTP_CATEGORY,
        $or: [
          { 'value.expiresAt': { $lt: retentionCutoff } },
          { 'value.isUsed': true, 'value.usedAt': { $lt: retentionCutoff } }
        ]
      });

      // Track cleanup
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp_store',
        'cleanup_completed',
        {
          deletedCount: result.deletedCount || 0,
          retentionHours: this.RETENTION_HOURS
        }
      );

      return {
        deleted: result.deletedCount || 0,
        errors: 0
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_store',
        action: 'cleanup_expired'
      });

      return {
        deleted: 0,
        errors: 1
      };
    }
  }

  // Get all active OTPs (for debugging)
  async getAllActiveOTPs(): Promise<StoredOTP[]> {
    try {
      await connectDB();

      const now = new Date();
      const settings = await Settings.find({
        category: this.OTP_CATEGORY
      }).lean();

      return settings
        .map(setting => ({
          ...setting.value,
          expiresAt: new Date(setting.value.expiresAt),
          createdAt: new Date(setting.value.createdAt),
          usedAt: setting.value.usedAt ? new Date(setting.value.usedAt) : undefined,
          lastResendAt: setting.value.lastResendAt ? new Date(setting.value.lastResendAt) : undefined,
          isExpired: now > new Date(setting.value.expiresAt)
        }))
        .filter(otp => !otp.isUsed && !otp.isExpired);

    } catch (error) {
      console.error('Error getting all active OTPs:', error);
      return [];
    }
  }

  // ==============================================
  // PRIVATE HELPER METHODS
  // ==============================================

  // Generate unique OTP ID
  private generateOTPId(): string {
    return `otp_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  // Generate OTP storage key
  private getOTPKey(identifier: string, method: 'phone' | 'email'): string {
    // Create a hash-based key for privacy and consistency
    const combinedKey = `${method}:${identifier}`;
    return `otp_${EncryptionService.hash(combinedKey).substring(0, 16)}`;
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
  private maskPhoneNumber(phoneNumber: string): string {
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
}

// ==============================================
// EXPORT SINGLETON INSTANCE
// ==============================================

export const otpStore = OTPStore.getInstance();