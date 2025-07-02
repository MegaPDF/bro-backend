import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import { analyticsTracker } from '../analytics/tracker';
import { OTP_CONFIG, RATE_LIMITS, TIME_CONSTANTS } from '@/lib/utils/constants';
import { EncryptionService } from '@/lib/utils/encryption';

export interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
  blockDurationMs?: number;
  cooldownMs?: number;
}

export interface RateLimitConfig {
  generation: {
    perPhone: RateLimitRule;
    perIP: RateLimitRule;
    perEmail: RateLimitRule;
    global: RateLimitRule;
  };
  validation: {
    perPhone: RateLimitRule;
    perIP: RateLimitRule;
    global: RateLimitRule;
  };
  resend: {
    perPhone: RateLimitRule;
    perIP: RateLimitRule;
  };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining?: number;
  resetTime?: Date;
  cooldownSeconds?: number;
  lockedUntil?: Date;
  reason?: string;
}

export interface RateLimitEntry {
  key: string;
  count: number;
  firstRequest: Date;
  lastRequest: Date;
  windowStart: Date;
  windowEnd: Date;
  isBlocked: boolean;
  blockedUntil?: Date;
  violations: number;
  metadata: {
    type: 'generation' | 'validation' | 'resend';
    identifier: string;
    phoneNumber?: string;
    ipAddress?: string;
    email?: string;
  };
}

export class OTPRateLimiter {
  private static instance: OTPRateLimiter;
  private readonly RATE_LIMIT_CATEGORY = 'otp_rate_limits';
  private cache = new Map<string, RateLimitEntry>();
  private readonly CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
  
  private readonly defaultConfig: RateLimitConfig = {
    generation: {
      perPhone: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 3,
        blockDurationMs: 5 * 60 * 1000, // 5 minutes
        cooldownMs: 60 * 1000 // 1 minute between requests
      },
      perIP: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 20,
        blockDurationMs: 30 * 60 * 1000 // 30 minutes
      },
      perEmail: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 2,
        cooldownMs: 60 * 1000
      },
      global: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 100
      }
    },
    validation: {
      perPhone: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: OTP_CONFIG.MAX_ATTEMPTS * 3, // Allow multiple OTP generations
        blockDurationMs: 15 * 60 * 1000 // 15 minutes
      },
      perIP: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 50,
        blockDurationMs: 60 * 60 * 1000 // 1 hour
      },
      global: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 500
      }
    },
    resend: {
      perPhone: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 1,
        cooldownMs: OTP_CONFIG.RESEND_COOLDOWN_SECONDS * 1000
      },
      perIP: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 10,
        blockDurationMs: 30 * 60 * 1000
      }
    }
  };

  private constructor() {
    this.startCleanupTask();
  }

  static getInstance(): OTPRateLimiter {
    if (!OTPRateLimiter.instance) {
      OTPRateLimiter.instance = new OTPRateLimiter();
    }
    return OTPRateLimiter.instance;
  }

  // Check if OTP generation is allowed
  async checkGenerationLimit(
    phoneNumber: string,
    email?: string,
    ipAddress?: string
  ): Promise<RateLimitResult> {
    try {
      const checks = [
        // Per phone number check
        this.checkLimit(
          this.getPhoneKey(phoneNumber, 'generation'),
          this.defaultConfig.generation.perPhone,
          'generation',
          { phoneNumber }
        ),
        // Global generation check
        this.checkLimit(
          'global_generation',
          this.defaultConfig.generation.global,
          'generation',
          { global: true }
        )
      ];

      // Add IP-based check if available
      if (ipAddress) {
        checks.push(
          this.checkLimit(
            this.getIPKey(ipAddress, 'generation'),
            this.defaultConfig.generation.perIP,
            'generation',
            { ipAddress }
          )
        );
      }

      // Add email-based check if available
      if (email) {
        checks.push(
          this.checkLimit(
            this.getEmailKey(email, 'generation'),
            this.defaultConfig.generation.perEmail,
            'generation',
            { email }
          )
        );
      }

      const results = await Promise.all(checks);
      
      // Return the most restrictive result
      const blocked = results.find(result => !result.allowed);
      if (blocked) {
        // Track rate limit hit
        await analyticsTracker.trackFeatureUsage(
          'system',
          'otp_rate_limiter',
          'generation_blocked',
          {
            phoneNumber: this.maskPhoneNumber(phoneNumber),
            reason: blocked.reason,
            ipAddress: ipAddress ? this.maskIP(ipAddress) : undefined,
            email: email ? this.maskEmail(email) : undefined
          }
        );

        return blocked;
      }

      return { allowed: true };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_rate_limiter',
        action: 'check_generation_limit'
      });

      // Allow on error to prevent blocking legitimate users
      return { allowed: true };
    }
  }

  // Check if OTP validation is allowed
  async checkValidationLimit(
    phoneNumber: string,
    ipAddress?: string
  ): Promise<RateLimitResult> {
    try {
      const checks = [
        // Per phone number check
        this.checkLimit(
          this.getPhoneKey(phoneNumber, 'validation'),
          this.defaultConfig.validation.perPhone,
          'validation',
          { phoneNumber }
        ),
        // Global validation check
        this.checkLimit(
          'global_validation',
          this.defaultConfig.validation.global,
          'validation',
          { global: true }
        )
      ];

      // Add IP-based check if available
      if (ipAddress) {
        checks.push(
          this.checkLimit(
            this.getIPKey(ipAddress, 'validation'),
            this.defaultConfig.validation.perIP,
            'validation',
            { ipAddress }
          )
        );
      }

      const results = await Promise.all(checks);
      
      // Return the most restrictive result
      const blocked = results.find(result => !result.allowed);
      if (blocked) {
        // Track validation rate limit hit
        await analyticsTracker.trackFeatureUsage(
          'system',
          'otp_rate_limiter',
          'validation_blocked',
          {
            phoneNumber: this.maskPhoneNumber(phoneNumber),
            reason: blocked.reason,
            ipAddress: ipAddress ? this.maskIP(ipAddress) : undefined
          }
        );

        return blocked;
      }

      return { allowed: true };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_rate_limiter',
        action: 'check_validation_limit'
      });

      // Allow on error
      return { allowed: true };
    }
  }

  // Check if OTP resend is allowed
  async checkResendLimit(
    phoneNumber: string,
    ipAddress?: string
  ): Promise<RateLimitResult> {
    try {
      const checks = [
        // Per phone number resend check
        this.checkLimit(
          this.getPhoneKey(phoneNumber, 'resend'),
          this.defaultConfig.resend.perPhone,
          'resend',
          { phoneNumber }
        )
      ];

      // Add IP-based check if available
      if (ipAddress) {
        checks.push(
          this.checkLimit(
            this.getIPKey(ipAddress, 'resend'),
            this.defaultConfig.resend.perIP,
            'resend',
            { ipAddress }
          )
        );
      }

      const results = await Promise.all(checks);
      
      // Return the most restrictive result
      const blocked = results.find(result => !result.allowed);
      if (blocked) {
        // Track resend rate limit hit
        await analyticsTracker.trackFeatureUsage(
          'system',
          'otp_rate_limiter',
          'resend_blocked',
          {
            phoneNumber: this.maskPhoneNumber(phoneNumber),
            reason: blocked.reason,
            ipAddress: ipAddress ? this.maskIP(ipAddress) : undefined
          }
        );

        return blocked;
      }

      return { allowed: true };

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', {
        component: 'otp_rate_limiter',
        action: 'check_resend_limit'
      });

      // Allow on error
      return { allowed: true };
    }
  }

  // Core rate limiting logic
  private async checkLimit(
    key: string,
    rule: RateLimitRule,
    type: 'generation' | 'validation' | 'resend',
    metadata: Record<string, any>
  ): Promise<RateLimitResult> {
    const now = new Date();
    let entry = await this.getRateLimitEntry(key);

    // Create new entry if doesn't exist
    if (!entry) {
      entry = {
        key,
        count: 0,
        firstRequest: now,
        lastRequest: now,
        windowStart: now,
        windowEnd: new Date(now.getTime() + rule.windowMs),
        isBlocked: false,
        violations: 0,
        metadata: {
          type,
          identifier: key,
          phoneNumber: metadata.phoneNumber,
          ipAddress: metadata.ipAddress,
          email: metadata.email
        }
      };
    }

    // Check if currently blocked
    if (entry.isBlocked && entry.blockedUntil && now < entry.blockedUntil) {
      const cooldownSeconds = Math.ceil((entry.blockedUntil.getTime() - now.getTime()) / 1000);
      return {
        allowed: false,
        reason: 'blocked_violation',
        cooldownSeconds,
        lockedUntil: entry.blockedUntil
      };
    }

    // Reset window if expired
    if (now >= entry.windowEnd) {
      entry.count = 0;
      entry.windowStart = now;
      entry.windowEnd = new Date(now.getTime() + rule.windowMs);
      entry.isBlocked = false;
      entry.blockedUntil = undefined;
    }

    // Check cooldown (for generation and resend)
    if (rule.cooldownMs && entry.lastRequest) {
      const timeSinceLastRequest = now.getTime() - entry.lastRequest.getTime();
      if (timeSinceLastRequest < rule.cooldownMs) {
        const cooldownSeconds = Math.ceil((rule.cooldownMs - timeSinceLastRequest) / 1000);
        return {
          allowed: false,
          reason: 'cooldown_active',
          cooldownSeconds,
          resetTime: new Date(entry.lastRequest.getTime() + rule.cooldownMs)
        };
      }
    }

    // Increment counter
    entry.count++;
    entry.lastRequest = now;

    // Check if limit exceeded
    if (entry.count > rule.maxRequests) {
      entry.violations++;
      
      // Apply block if rule specifies block duration
      if (rule.blockDurationMs) {
        entry.isBlocked = true;
        entry.blockedUntil = new Date(now.getTime() + rule.blockDurationMs);
      }

      // Store updated entry
      await this.storeRateLimitEntry(entry);

      const cooldownSeconds = rule.blockDurationMs ? 
        Math.ceil(rule.blockDurationMs / 1000) : 
        Math.ceil((entry.windowEnd.getTime() - now.getTime()) / 1000);

      return {
        allowed: false,
        reason: 'rate_limit_exceeded',
        remaining: 0,
        resetTime: entry.windowEnd,
        cooldownSeconds,
        lockedUntil: entry.blockedUntil
      };
    }

    // Store updated entry
    await this.storeRateLimitEntry(entry);

    return {
      allowed: true,
      remaining: rule.maxRequests - entry.count,
      resetTime: entry.windowEnd
    };
  }

  // Get rate limit entry from cache or database
  private async getRateLimitEntry(key: string): Promise<RateLimitEntry | null> {
    // Check cache first
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    // Check database
    try {
      await connectDB();

      const setting = await Settings.findOne({
        category: this.RATE_LIMIT_CATEGORY,
        key
      });

      if (setting?.value) {
        const entry = setting.value as RateLimitEntry;
        // Add to cache
        this.cache.set(key, entry);
        return entry;
      }
    } catch (error) {
      console.error('Error getting rate limit entry:', error);
    }

    return null;
  }

  // Store rate limit entry to cache and database
  private async storeRateLimitEntry(entry: RateLimitEntry): Promise<void> {
    try {
      // Update cache
      this.cache.set(entry.key, entry);

      // Update database
      await connectDB();

      await Settings.findOneAndUpdate(
        { 
          category: this.RATE_LIMIT_CATEGORY, 
          key: entry.key 
        },
        {
          value: entry,
          type: 'object',
          description: `Rate limit entry for ${entry.metadata.type}`,
          isEncrypted: false,
          isPublic: false,
          updatedBy: 'system'
        },
        { upsert: true, new: true }
      );

    } catch (error) {
      console.error('Error storing rate limit entry:', error);
    }
  }

  // Generate rate limit keys
  private getPhoneKey(phoneNumber: string, type: string): string {
    return `phone_${type}_${EncryptionService.hash(phoneNumber).substring(0, 16)}`;
  }

  private getIPKey(ipAddress: string, type: string): string {
    return `ip_${type}_${EncryptionService.hash(ipAddress).substring(0, 16)}`;
  }

  private getEmailKey(email: string, type: string): string {
    return `email_${type}_${EncryptionService.hash(email.toLowerCase()).substring(0, 16)}`;
  }

  // Mask sensitive data for logging
  private maskPhoneNumber(phoneNumber: string): string {
    if (phoneNumber.length <= 4) return phoneNumber;
    const visibleDigits = 2;
    const start = phoneNumber.substring(0, visibleDigits);
    const end = phoneNumber.substring(phoneNumber.length - visibleDigits);
    const masked = '*'.repeat(phoneNumber.length - (visibleDigits * 2));
    return start + masked + end;
  }

  private maskIP(ipAddress: string): string {
    const parts = ipAddress.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.xxx.xxx`;
    }
    return ipAddress.substring(0, 8) + '****';
  }

  private maskEmail(email: string): string {
    const [user, domain] = email.split('@');
    const maskedUser = user.length > 2 ? 
      user.substring(0, 2) + '*'.repeat(user.length - 2) : 
      user;
    return `${maskedUser}@${domain}`;
  }

  // Clear rate limits for a specific identifier
  async clearRateLimits(
    identifier: string,
    type?: 'phone' | 'ip' | 'email'
  ): Promise<{
    success: boolean;
    cleared: number;
    error?: string;
  }> {
    try {
      await connectDB();

      const query: any = { category: this.RATE_LIMIT_CATEGORY };

      if (type === 'phone') {
        query.key = { $regex: `^phone_.*_${EncryptionService.hash(identifier).substring(0, 16)}` };
      } else if (type === 'ip') {
        query.key = { $regex: `^ip_.*_${EncryptionService.hash(identifier).substring(0, 16)}` };
      } else if (type === 'email') {
        query.key = { $regex: `^email_.*_${EncryptionService.hash(identifier.toLowerCase()).substring(0, 16)}` };
      } else {
        // Clear all rate limits containing the identifier
        const phonePattern = EncryptionService.hash(identifier).substring(0, 16);
        query.$or = [
          { key: { $regex: `phone_.*_${phonePattern}` } },
          { key: { $regex: `ip_.*_${phonePattern}` } },
          { key: { $regex: `email_.*_${phonePattern}` } }
        ];
      }

      const result = await Settings.deleteMany(query);

      // Clear from cache
      for (const [key, entry] of this.cache.entries()) {
        if (
          (type === 'phone' && entry.metadata.phoneNumber === identifier) ||
          (type === 'ip' && entry.metadata.ipAddress === identifier) ||
          (type === 'email' && entry.metadata.email === identifier) ||
          (!type && (
            entry.metadata.phoneNumber === identifier ||
            entry.metadata.ipAddress === identifier ||
            entry.metadata.email === identifier
          ))
        ) {
          this.cache.delete(key);
        }
      }

      return {
        success: true,
        cleared: result.deletedCount || 0
      };

    } catch (error: any) {
      return {
        success: false,
        cleared: 0,
        error: error.message
      };
    }
  }

  // Get rate limit statistics
  async getRateLimitStatistics(): Promise<{
    totalEntries: number;
    blockedEntries: number;
    generationLimits: number;
    validationLimits: number;
    resendLimits: number;
    topViolators: Array<{
      identifier: string;
      violations: number;
      type: string;
    }>;
  }> {
    try {
      await connectDB();

      const entries = await Settings.find({
        category: this.RATE_LIMIT_CATEGORY
      });

      const stats = {
        totalEntries: entries.length,
        blockedEntries: 0,
        generationLimits: 0,
        validationLimits: 0,
        resendLimits: 0,
        topViolators: [] as Array<{
          identifier: string;
          violations: number;
          type: string;
        }>
      };

      entries.forEach(setting => {
        const entry = setting.value as RateLimitEntry;
        
        if (entry.isBlocked) {
          stats.blockedEntries++;
        }

        switch (entry.metadata.type) {
          case 'generation':
            stats.generationLimits++;
            break;
          case 'validation':
            stats.validationLimits++;
            break;
          case 'resend':
            stats.resendLimits++;
            break;
        }

        if (entry.violations > 0) {
          stats.topViolators.push({
            identifier: entry.metadata.phoneNumber || 
                       entry.metadata.ipAddress || 
                       entry.metadata.email || 
                       'unknown',
            violations: entry.violations,
            type: entry.metadata.type
          });
        }
      });

      // Sort violators by violations count
      stats.topViolators.sort((a, b) => b.violations - a.violations);
      stats.topViolators = stats.topViolators.slice(0, 10); // Top 10

      return stats;

    } catch (error) {
      console.error('Error getting rate limit statistics:', error);
      return {
        totalEntries: 0,
        blockedEntries: 0,
        generationLimits: 0,
        validationLimits: 0,
        resendLimits: 0,
        topViolators: []
      };
    }
  }

  // Cleanup expired rate limit entries
  private async cleanupExpiredEntries(): Promise<void> {
    try {
      const now = new Date();
      const cutoffTime = new Date(now.getTime() - 24 * TIME_CONSTANTS.HOUR); // Keep for 24 hours

      // Clean cache
      for (const [key, entry] of this.cache.entries()) {
        if (entry.windowEnd < cutoffTime && !entry.isBlocked) {
          this.cache.delete(key);
        }
      }

      // Clean database
      await connectDB();
      await Settings.deleteMany({
        category: this.RATE_LIMIT_CATEGORY,
        $and: [
          { 'value.windowEnd': { $lt: cutoffTime } },
          { 'value.isBlocked': { $ne: true } }
        ]
      });

      console.log('Rate limit cleanup completed');
    } catch (error) {
      console.error('Error in rate limit cleanup:', error);
    }
  }

  // Start cleanup task
  private startCleanupTask(): void {
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, this.CACHE_CLEANUP_INTERVAL);

    // Run initial cleanup after 30 seconds
    setTimeout(() => {
      this.cleanupExpiredEntries();
    }, 30000);
  }
}

// Export singleton instance
export const otpRateLimiter = OTPRateLimiter.getInstance();