// ==============================================
// COMPLETE OTP RATE LIMITER
// Supports both Phone & Email Methods
// ==============================================

// File: src/lib/services/otp/rate-limiter.ts

import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import { analyticsTracker } from '../analytics/tracker';
import { EncryptionService } from '@/lib/utils/encryption';
import { TIME_CONSTANTS, OTP_CONFIG } from '@/lib/utils/constants';

// ==============================================
// INTERFACES
// ==============================================

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts?: number;
  cooldownSeconds?: number;
  resetTime?: Date;
}

export interface RateLimitConfig {
  windowMs: number;
  maxAttempts: number;
  cooldownMs: number;
}

export interface RateLimitEntry {
  identifier: string;
  method: 'phone' | 'email';
  attempts: number;
  windowStart: Date;
  lastAttempt: Date;
  cooldownUntil?: Date;
}

// ==============================================
// RATE LIMITER CLASS
// ==============================================

export class OTPRateLimiter {
  private static instance: OTPRateLimiter;
  private readonly RATE_LIMIT_CATEGORY = 'otp_rate_limits';

  // Rate limit configurations
  private readonly configs = {
    generation: {
      windowMs: 15 * TIME_CONSTANTS.MINUTE, // 15 minutes
      maxAttempts: 5, // 5 OTP generations per 15 minutes
      cooldownMs: 5 * TIME_CONSTANTS.MINUTE // 5 minute cooldown after hitting limit
    },
    resend: {
      windowMs: 5 * TIME_CONSTANTS.MINUTE, // 5 minutes
      maxAttempts: 3, // 3 resends per 5 minutes
      cooldownMs: 2 * TIME_CONSTANTS.MINUTE // 2 minute cooldown
    },
    validation: {
      windowMs: 5 * TIME_CONSTANTS.MINUTE, // 5 minutes
      maxAttempts: 10, // 10 validation attempts per 5 minutes
      cooldownMs: 1 * TIME_CONSTANTS.MINUTE // 1 minute cooldown
    }
  };

  private constructor() {
    // Initialize cleanup interval
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, TIME_CONSTANTS.HOUR); // Cleanup every hour
  }

  static getInstance(): OTPRateLimiter {
    if (!OTPRateLimiter.instance) {
      OTPRateLimiter.instance = new OTPRateLimiter();
    }
    return OTPRateLimiter.instance;
  }

  // ==============================================
  // MAIN RATE LIMITING METHODS
  // ==============================================

  // Check generation rate limit
  async checkGenerationLimit(
    identifier: string,
    method: 'phone' | 'email'
  ): Promise<RateLimitResult> {
    return this.checkRateLimit(identifier, method, 'generation');
  }

  // Check resend rate limit
  async checkResendLimit(
    identifier: string,
    method: 'phone' | 'email'
  ): Promise<RateLimitResult> {
    return this.checkRateLimit(identifier, method, 'resend');
  }

  // Check validation rate limit
  async checkValidationLimit(
    identifier: string,
    method: 'phone' | 'email'
  ): Promise<RateLimitResult> {
    return this.checkRateLimit(identifier, method, 'validation');
  }

  // Record attempt
  async recordAttempt(
    identifier: string,
    method: 'phone' | 'email',
    type: 'generation' | 'resend' | 'validation'
  ): Promise<void> {
    try {
      await connectDB();

      const key = this.getRateLimitKey(identifier, method, type);
      const now = new Date();
      const config = this.configs[type];

      // Get existing entry
      const existing = await this.getRateLimitEntry(key);
      
      if (existing) {
        // Check if we need to reset the window
        const windowExpired = (now.getTime() - existing.windowStart.getTime()) > config.windowMs;
        
        if (windowExpired) {
          // Reset window
          await this.updateRateLimitEntry(key, {
            identifier,
            method,
            attempts: 1,
            windowStart: now,
            lastAttempt: now
          });
        } else {
          // Increment attempts
          await this.updateRateLimitEntry(key, {
            ...existing,
            attempts: existing.attempts + 1,
            lastAttempt: now
          });
        }
      } else {
        // Create new entry
        await this.createRateLimitEntry(key, {
          identifier,
          method,
          attempts: 1,
          windowStart: now,
          lastAttempt: now
        });
      }

      // Track rate limit attempt
      await analyticsTracker.trackFeatureUsage(
        'system',
        'rate_limiter',
        'attempt_recorded',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          type
        }
      );

    } catch (error: any) {
      console.error('Error recording rate limit attempt:', error);
      
      await analyticsTracker.trackError(error, 'system', {
        component: 'rate_limiter',
        action: 'record_attempt',
        method,
        type
      });
    }
  }

  // Set cooldown
  async setCooldown(
    identifier: string,
    method: 'phone' | 'email',
    type: 'generation' | 'resend' | 'validation',
    cooldownMs: number
  ): Promise<void> {
    try {
      await connectDB();

      const key = this.getRateLimitKey(identifier, method, type);
      const cooldownUntil = new Date(Date.now() + cooldownMs);

      const existing = await this.getRateLimitEntry(key);
      
      if (existing) {
        await this.updateRateLimitEntry(key, {
          ...existing,
          cooldownUntil
        });
      } else {
        await this.createRateLimitEntry(key, {
          identifier,
          method,
          attempts: 0,
          windowStart: new Date(),
          lastAttempt: new Date(),
          cooldownUntil
        });
      }

      // Track cooldown
      await analyticsTracker.trackFeatureUsage(
        'system',
        'rate_limiter',
        'cooldown_set',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          type,
          cooldownMinutes: Math.round(cooldownMs / TIME_CONSTANTS.MINUTE)
        }
      );

    } catch (error: any) {
      console.error('Error setting cooldown:', error);
      
      await analyticsTracker.trackError(error, 'system', {
        component: 'rate_limiter',
        action: 'set_cooldown',
        method,
        type
      });
    }
  }

  // Clear rate limit for identifier
  async clearRateLimit(
    identifier: string,
    method: 'phone' | 'email',
    type?: 'generation' | 'resend' | 'validation'
  ): Promise<void> {
    try {
      await connectDB();

      if (type) {
        const key = this.getRateLimitKey(identifier, method, type);
        await Settings.findOneAndDelete({
          category: this.RATE_LIMIT_CATEGORY,
          key
        });
      } else {
        // Clear all rate limits for this identifier
        const keys = [
          this.getRateLimitKey(identifier, method, 'generation'),
          this.getRateLimitKey(identifier, method, 'resend'),
          this.getRateLimitKey(identifier, method, 'validation')
        ];

        await Settings.deleteMany({
          category: this.RATE_LIMIT_CATEGORY,
          key: { $in: keys }
        });
      }

      // Track clearing
      await analyticsTracker.trackFeatureUsage(
        'system',
        'rate_limiter',
        'rate_limit_cleared',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          type: type || 'all'
        }
      );

    } catch (error: any) {
      console.error('Error clearing rate limit:', error);
    }
  }

  // ==============================================
  // PRIVATE HELPER METHODS
  // ==============================================

  // Generic rate limit check
  private async checkRateLimit(
    identifier: string,
    method: 'phone' | 'email',
    type: 'generation' | 'resend' | 'validation'
  ): Promise<RateLimitResult> {
    try {
      await connectDB();

      const key = this.getRateLimitKey(identifier, method, type);
      const config = this.configs[type];
      const now = new Date();

      const entry = await this.getRateLimitEntry(key);

      if (!entry) {
        // No rate limit entry, allow request
        return {
          allowed: true,
          remainingAttempts: config.maxAttempts - 1
        };
      }

      // Check if in cooldown period
      if (entry.cooldownUntil && now < entry.cooldownUntil) {
        const cooldownSeconds = Math.ceil((entry.cooldownUntil.getTime() - now.getTime()) / 1000);
        
        await analyticsTracker.trackFeatureUsage(
          'system',
          'rate_limiter',
          'request_blocked_cooldown',
          {
            identifier: this.maskIdentifier(identifier, method),
            method,
            type,
            cooldownSeconds
          }
        );

        return {
          allowed: false,
          cooldownSeconds,
          resetTime: entry.cooldownUntil
        };
      }

      // Check if window has expired
      const windowExpired = (now.getTime() - entry.windowStart.getTime()) > config.windowMs;
      
      if (windowExpired) {
        // Window expired, allow request
        return {
          allowed: true,
          remainingAttempts: config.maxAttempts - 1
        };
      }

      // Check if within rate limit
      if (entry.attempts < config.maxAttempts) {
        return {
          allowed: true,
          remainingAttempts: config.maxAttempts - entry.attempts - 1
        };
      }

      // Rate limit exceeded
      const resetTime = new Date(entry.windowStart.getTime() + config.windowMs);
      const cooldownSeconds = Math.ceil((resetTime.getTime() - now.getTime()) / 1000);

      // Set cooldown
      await this.setCooldown(identifier, method, type, config.cooldownMs);

      await analyticsTracker.trackFeatureUsage(
        'system',
        'rate_limiter',
        'request_blocked_limit',
        {
          identifier: this.maskIdentifier(identifier, method),
          method,
          type,
          attempts: entry.attempts,
          maxAttempts: config.maxAttempts
        }
      );

      return {
        allowed: false,
        cooldownSeconds: Math.max(cooldownSeconds, config.cooldownMs / 1000),
        resetTime
      };

    } catch (error: any) {
      console.error('Error checking rate limit:', error);
      
      await analyticsTracker.trackError(error, 'system', {
        component: 'rate_limiter',
        action: 'check_rate_limit',
        method,
        type
      });

      // On error, allow the request to avoid blocking legitimate users
      return { allowed: true };
    }
  }

  // Get rate limit entry from database
  private async getRateLimitEntry(key: string): Promise<RateLimitEntry | null> {
    try {
      const setting = await Settings.findOne({
        category: this.RATE_LIMIT_CATEGORY,
        key
      });

      if (!setting || !setting.value) {
        return null;
      }

      const data = setting.value;
      return {
        ...data,
        windowStart: new Date(data.windowStart),
        lastAttempt: new Date(data.lastAttempt),
        cooldownUntil: data.cooldownUntil ? new Date(data.cooldownUntil) : undefined
      };

    } catch (error) {
      console.error('Error getting rate limit entry:', error);
      return null;
    }
  }

  // Create rate limit entry
  private async createRateLimitEntry(key: string, entry: RateLimitEntry): Promise<void> {
    await Settings.create({
      category: this.RATE_LIMIT_CATEGORY,
      key,
      value: entry,
      type: 'object',
      description: `Rate limit for ${entry.method}: ${this.maskIdentifier(entry.identifier, entry.method)}`,
      isPublic: false,
      expiresAt: new Date(Date.now() + 24 * TIME_CONSTANTS.HOUR) // Expire after 24 hours
    });
  }

  // Update rate limit entry
  private async updateRateLimitEntry(key: string, entry: Partial<RateLimitEntry>): Promise<void> {
    await Settings.findOneAndUpdate(
      {
        category: this.RATE_LIMIT_CATEGORY,
        key
      },
      {
        $set: { value: entry }
      },
      { upsert: true }
    );
  }

  // Generate rate limit key
  private getRateLimitKey(identifier: string, method: 'phone' | 'email', type: string): string {
    const combinedKey = `${method}:${type}:${identifier}`;
    return `rate_limit_${EncryptionService.hash(combinedKey).substring(0, 16)}`;
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
    const start = phoneNumber.substring(0, visibleDigits + 1);
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
  // MONITORING AND CLEANUP
  // ==============================================

  // Get rate limit statistics
  async getRateLimitStatistics(): Promise<{
    activeEntries: number;
    cooldownEntries: number;
    methodBreakdown: {
      phone: { active: number; cooldown: number };
      email: { active: number; cooldown: number };
    };
    typeBreakdown: {
      generation: { active: number; blocked: number };
      resend: { active: number; blocked: number };
      validation: { active: number; blocked: number };
    };
  }> {
    try {
      await connectDB();

      const entries = await Settings.find({
        category: this.RATE_LIMIT_CATEGORY
      }).lean();

      const now = new Date();
      const stats = {
        activeEntries: 0,
        cooldownEntries: 0,
        methodBreakdown: {
          phone: { active: 0, cooldown: 0 },
          email: { active: 0, cooldown: 0 }
        },
        typeBreakdown: {
          generation: { active: 0, blocked: 0 },
          resend: { active: 0, blocked: 0 },
          validation: { active: 0, blocked: 0 }
        }
      };

      entries.forEach(setting => {
        const entry = setting.value;
        const isInCooldown = entry.cooldownUntil && now < new Date(entry.cooldownUntil);

        stats.activeEntries++;
        
        if (isInCooldown) {
          stats.cooldownEntries++;
          stats.methodBreakdown[entry.method].cooldown++;
        } else {
          stats.methodBreakdown[entry.method].active++;
        }

        // Extract type from key (this is a simplified approach)
        if (setting.key.includes('generation')) {
          if (isInCooldown) {
            stats.typeBreakdown.generation.blocked++;
          } else {
            stats.typeBreakdown.generation.active++;
          }
        } else if (setting.key.includes('resend')) {
          if (isInCooldown) {
            stats.typeBreakdown.resend.blocked++;
          } else {
            stats.typeBreakdown.resend.active++;
          }
        } else if (setting.key.includes('validation')) {
          if (isInCooldown) {
            stats.typeBreakdown.validation.blocked++;
          } else {
            stats.typeBreakdown.validation.active++;
          }
        }
      });

      return stats;

    } catch (error) {
      console.error('Error getting rate limit statistics:', error);
      return {
        activeEntries: 0,
        cooldownEntries: 0,
        methodBreakdown: {
          phone: { active: 0, cooldown: 0 },
          email: { active: 0, cooldown: 0 }
        },
        typeBreakdown: {
          generation: { active: 0, blocked: 0 },
          resend: { active: 0, blocked: 0 },
          validation: { active: 0, blocked: 0 }
        }
      };
    }
  }

  // Cleanup expired rate limit entries
  async cleanupExpiredEntries(): Promise<{ deleted: number; errors: number }> {
    try {
      await connectDB();

      const now = new Date();
      const maxAge = 24 * TIME_CONSTANTS.HOUR; // 24 hours
      const cutoff = new Date(now.getTime() - maxAge);

      const result = await Settings.deleteMany({
        category: this.RATE_LIMIT_CATEGORY,
        $or: [
          { expiresAt: { $lt: now } },
          { createdAt: { $lt: cutoff } },
          { 'value.cooldownUntil': { $lt: now } }
        ]
      });

      // Track cleanup
      await analyticsTracker.trackFeatureUsage(
        'system',
        'rate_limiter',
        'cleanup_completed',
        {
          deletedCount: result.deletedCount || 0
        }
      );

      console.log(`Rate limit cleanup completed: ${result.deletedCount} entries deleted`);

      return {
        deleted: result.deletedCount || 0,
        errors: 0
      };

    } catch (error: any) {
      console.error('Error cleaning up rate limit entries:', error);
      
      await analyticsTracker.trackError(error, 'system', {
        component: 'rate_limiter',
        action: 'cleanup'
      });

      return {
        deleted: 0,
        errors: 1
      };
    }
  }

  // Health check
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    stats: {
      activeEntries: number;
      cooldownEntries: number;
    };
  }> {
    try {
      const stats = await this.getRateLimitStatistics();
      
      return {
        status: 'healthy',
        stats: {
          activeEntries: stats.activeEntries,
          cooldownEntries: stats.cooldownEntries
        }
      };
    } catch (error) {
      console.error('Rate limiter health check failed:', error);
      return {
        status: 'unhealthy',
        stats: {
          activeEntries: 0,
          cooldownEntries: 0
        }
      };
    }
  }
}

// ==============================================
// EXPORT SINGLETON INSTANCE
// ==============================================

export const otpRateLimiter = OTPRateLimiter.getInstance();