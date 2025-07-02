import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import { analyticsTracker } from '../analytics/tracker';
import { OTP_CONFIG, TIME_CONSTANTS } from '@/lib/utils/constants';
import { EncryptionService } from '@/lib/utils/encryption';

export interface StoredOTP {
  id: string;
  phoneNumber: string;
  countryCode: string;
  code: string;
  hashedCode: string;
  createdAt: Date;
  expiresAt: Date;
  isUsed: boolean;
  isExpired: boolean;
  attempts: number;
  maxAttempts: number;
  deliveryMethod: 'sms' | 'email' | 'both';
  deliveryInfo: {
    phoneNumber: string;
    countryCode: string;
    email?: string;
    userName?: string;
  };
  deliveryStatus: {
    sms?: {
      sent: boolean;
      sentAt?: Date;
      error?: string;
    };
    email?: {
      sent: boolean;
      sentAt?: Date;
      messageId?: string;
      error?: string;
    };
  };
  resendCount: number;
  lastResendAt?: Date;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

export interface OTPStoreOptions {
  phoneNumber: string;
  countryCode: string;
  code: string;
  expiresAt: Date;
  maxAttempts: number;
  deliveryMethod: 'sms' | 'email' | 'both';
  deliveryInfo: {
    phoneNumber: string;
    countryCode: string;
    email?: string;
    userName?: string;
  };
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

export interface OTPStatistics {
  activeCount: number;
  expiredCount: number;
  usedCount: number;
  dailyGenerated: number;
  dailyValidated: number;
  deliveryStats: {
    sms: { sent: number; failed: number };
    email: { sent: number; failed: number };
  };
}

export class OTPStore {
  private static instance: OTPStore;
  private readonly OTP_CATEGORY = 'otp_storage';
  private readonly CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  private readonly RETENTION_HOURS = 24; // Keep expired OTPs for 24 hours for analytics

  private constructor() {
    this.startCleanupTask();
  }

  static getInstance(): OTPStore {
    if (!OTPStore.instance) {
      OTPStore.instance = new OTPStore();
    }
    return OTPStore.instance;
  }

  // Store OTP in database
  async storeOTP(options: OTPStoreOptions): Promise<{
    success: boolean;
    otpId?: string;
    error?: string;
  }> {
    try {
      await connectDB();

      // Generate unique OTP ID
      const otpId = this.generateOTPId();

      // Hash the OTP code for security
      const hashedCode = await EncryptionService.hashPassword(options.code);

      // Create stored OTP object
      const storedOTP: StoredOTP = {
        id: otpId,
        phoneNumber: options.phoneNumber,
        countryCode: options.countryCode,
        code: options.code, // Store plaintext temporarily for verification
        hashedCode,
        createdAt: new Date(),
        expiresAt: options.expiresAt,
        isUsed: false,
        isExpired: false,
        attempts: 0,
        maxAttempts: options.maxAttempts,
        deliveryMethod: options.deliveryMethod,
        deliveryInfo: options.deliveryInfo,
        deliveryStatus: {},
        resendCount: 0,
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        metadata: options.metadata || {}
      };

      // Store in database using phone number as key
      await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY, 
          key: this.getOTPKey(options.phoneNumber) 
        },
        {
          value: storedOTP,
          type: 'object',
          description: `OTP for phone ${this.maskPhoneNumber(options.phoneNumber)}`,
          isEncrypted: true,
          isPublic: false,
          updatedBy: 'system'
        },
        { upsert: true, new: true }
      );

      // Track storage analytics
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp_store',
        'stored',
        {
          otpId,
          phoneNumber: this.maskPhoneNumber(options.phoneNumber),
          deliveryMethod: options.deliveryMethod,
          expiryMinutes: Math.round((options.expiresAt.getTime() - Date.now()) / 60000)
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
        phoneNumber: this.maskPhoneNumber(options.phoneNumber)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Retrieve OTP from database
  async getOTP(phoneNumber: string): Promise<StoredOTP | null> {
    try {
      await connectDB();

      const setting = await Settings.findOne({
        category: this.OTP_CATEGORY,
        key: this.getOTPKey(phoneNumber)
      });

      if (!setting?.value) {
        return null;
      }

      const storedOTP = setting.value as StoredOTP;

      // Check if OTP is expired
      const now = new Date();
      if (now > storedOTP.expiresAt) {
        storedOTP.isExpired = true;
        // Update expired status in database
        await this.updateOTPStatus(phoneNumber, { isExpired: true });
      }

      return storedOTP;

    } catch (error: any) {
      console.error('Error retrieving OTP:', error);
      return null;
    }
  }

  // Mark OTP as used
  async markOTPAsUsed(phoneNumber: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await connectDB();

      const result = await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY, 
          key: this.getOTPKey(phoneNumber) 
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

      // Track usage analytics
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp_store',
        'marked_used',
        {
          phoneNumber: this.maskPhoneNumber(phoneNumber),
          otpId: result.value.id
        }
      );

      return { success: true };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_store',
        action: 'mark_used',
        phoneNumber: this.maskPhoneNumber(phoneNumber)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Increment OTP validation attempts
  async incrementOTPAttempts(phoneNumber: string): Promise<{
    success: boolean;
    attempts?: number;
    error?: string;
  }> {
    try {
      await connectDB();

      const result = await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY, 
          key: this.getOTPKey(phoneNumber) 
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

      // Track attempt analytics
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp_store',
        'attempt_incremented',
        {
          phoneNumber: this.maskPhoneNumber(phoneNumber),
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
        phoneNumber: this.maskPhoneNumber(phoneNumber)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Update OTP delivery status
  async updateDeliveryStatus(
    phoneNumber: string,
    method: 'sms' | 'email',
    status: {
      sent: boolean;
      sentAt?: Date;
      messageId?: string;
      error?: string;
    }
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await connectDB();

      const updateField = `value.deliveryStatus.${method}`;
      const result = await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY, 
          key: this.getOTPKey(phoneNumber) 
        },
        {
          $set: {
            [updateField]: {
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

      // Track delivery analytics
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp_store',
        'delivery_status_updated',
        {
          phoneNumber: this.maskPhoneNumber(phoneNumber),
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
        phoneNumber: this.maskPhoneNumber(phoneNumber)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Mark delivery as failed
  async markOTPDeliveryFailed(otpId: string, error: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await connectDB();

      const result = await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY,
          'value.id': otpId
        },
        {
          $set: {
            'value.deliveryFailed': true,
            'value.deliveryError': error,
            'value.deliveryFailedAt': new Date()
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
          error: error.substring(0, 100) // Limit error message length
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

  // Update delivery method (for resends)
  async updateOTPDeliveryMethod(
    phoneNumber: string,
    newMethod: 'sms' | 'email' | 'both'
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await connectDB();

      const result = await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY, 
          key: this.getOTPKey(phoneNumber) 
        },
        {
          $set: {
            'value.deliveryMethod': newMethod,
            'value.lastResendAt': new Date()
          },
          $inc: { 'value.resendCount': 1 }
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

  // Delete OTP from database
  async deleteOTP(phoneNumber: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await connectDB();

      const result = await Settings.deleteOne({
        category: this.OTP_CATEGORY,
        key: this.getOTPKey(phoneNumber)
      });

      // Track deletion
      await analyticsTracker.trackFeatureUsage(
        'system',
        'otp_store',
        'deleted',
        {
          phoneNumber: this.maskPhoneNumber(phoneNumber),
          found: result.deletedCount > 0
        }
      );

      return { success: true };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_store',
        action: 'delete_otp',
        phoneNumber: this.maskPhoneNumber(phoneNumber)
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Update OTP status (generic method)
  private async updateOTPStatus(
    phoneNumber: string,
    updates: Partial<StoredOTP>
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await connectDB();

      const updateFields: Record<string, any> = {};
      Object.keys(updates).forEach(key => {
        updateFields[`value.${key}`] = updates[key as keyof StoredOTP];
      });

      await Settings.findOneAndUpdate(
        { 
          category: this.OTP_CATEGORY, 
          key: this.getOTPKey(phoneNumber) 
        },
        { $set: updateFields },
        { new: true }
      );

      return { success: true };

    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get OTP statistics
  async getStatistics(): Promise<OTPStatistics> {
    try {
      await connectDB();

      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // Get all OTP records
      const otpRecords = await Settings.find({
        category: this.OTP_CATEGORY
      });

      const stats: OTPStatistics = {
        activeCount: 0,
        expiredCount: 0,
        usedCount: 0,
        dailyGenerated: 0,
        dailyValidated: 0,
        deliveryStats: {
          sms: { sent: 0, failed: 0 },
          email: { sent: 0, failed: 0 }
        }
      };

      otpRecords.forEach(record => {
        const otp = record.value as StoredOTP;
        const createdAt = new Date(otp.createdAt);

        // Count by status
        if (otp.isUsed) {
          stats.usedCount++;
          if (createdAt >= startOfDay) {
            stats.dailyValidated++;
          }
        } else if (otp.isExpired || now > new Date(otp.expiresAt)) {
          stats.expiredCount++;
        } else {
          stats.activeCount++;
        }

        // Daily generation count
        if (createdAt >= startOfDay) {
          stats.dailyGenerated++;
        }

        // Delivery statistics
        if (otp.deliveryStatus.sms) {
          if (otp.deliveryStatus.sms.sent) {
            stats.deliveryStats.sms.sent++;
          } else {
            stats.deliveryStats.sms.failed++;
          }
        }

        if (otp.deliveryStatus.email) {
          if (otp.deliveryStatus.email.sent) {
            stats.deliveryStats.email.sent++;
          } else {
            stats.deliveryStats.email.failed++;
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
        deliveryStats: {
          sms: { sent: 0, failed: 0 },
          email: { sent: 0, failed: 0 }
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

  // Private helper methods

  // Generate unique OTP ID
  private generateOTPId(): string {
    return `otp_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  // Generate OTP storage key
  private getOTPKey(phoneNumber: string): string {
    // Use hash of phone number for privacy
    return `otp_${EncryptionService.hash(phoneNumber).substring(0, 16)}`;
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

  // Start cleanup task
  private startCleanupTask(): void {
    setInterval(async () => {
      try {
        await this.cleanupExpiredOTPs();
        console.log('OTP cleanup task completed');
      } catch (error) {
        console.error('Error in OTP cleanup task:', error);
      }
    }, this.CLEANUP_INTERVAL);

    // Run initial cleanup
    setTimeout(() => {
      this.cleanupExpiredOTPs();
    }, 5000); // Wait 5 seconds after startup
  }

  // Get all active OTPs (for admin purposes)
  async getAllActiveOTPs(): Promise<StoredOTP[]> {
    try {
      await connectDB();

      const settings = await Settings.find({
        category: this.OTP_CATEGORY
      });

      const now = new Date();
      return settings
        .map(setting => setting.value as StoredOTP)
        .filter(otp => !otp.isUsed && !otp.isExpired && now <= new Date(otp.expiresAt));

    } catch (error) {
      console.error('Error getting active OTPs:', error);
      return [];
    }
  }

  // Get OTP by ID (for admin purposes)
  async getOTPById(otpId: string): Promise<StoredOTP | null> {
    try {
      await connectDB();

      const setting = await Settings.findOne({
        category: this.OTP_CATEGORY,
        'value.id': otpId
      });

      return setting?.value as StoredOTP || null;

    } catch (error) {
      console.error('Error getting OTP by ID:', error);
      return null;
    }
  }
}

// Export singleton instance
export const otpStore = OTPStore.getInstance();