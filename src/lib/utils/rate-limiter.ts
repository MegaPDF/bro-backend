import { NextRequest } from 'next/server';
import { RATE_LIMITS, ERROR_CODES } from './constants';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyGenerator?: (request: NextRequest) => string; // Custom key generator
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
  message?: string; // Custom error message
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetTime: Date;
  error?: string;
}

// In-memory store for rate limiting (use Redis in production)
class MemoryStore {
  private store = new Map<string, { count: number; resetTime: number }>();

  async get(key: string): Promise<{ count: number; resetTime: number } | null> {
    const data = this.store.get(key);
    
    // Clean up expired entries
    if (data && Date.now() > data.resetTime) {
      this.store.delete(key);
      return null;
    }
    
    return data || null;
  }

  async set(key: string, value: { count: number; resetTime: number }): Promise<void> {
    this.store.set(key, value);
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetTime: number }> {
    const now = Date.now();
    const resetTime = now + windowMs;
    const existing = await this.get(key);

    if (!existing) {
      const newValue = { count: 1, resetTime };
      await this.set(key, newValue);
      return newValue;
    }

    existing.count += 1;
    await this.set(key, existing);
    return existing;
  }

  // Clean up expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, data] of this.store.entries()) {
      if (now > data.resetTime) {
        this.store.delete(key);
      }
    }
  }
}

export class RateLimiter {
  private static store = new MemoryStore();

  // Clean up expired entries every 5 minutes
  static {
    setInterval(() => {
      this.store.cleanup();
    }, 5 * 60 * 1000);
  }

  // Default key generator (IP + User-Agent)
  private static defaultKeyGenerator(request: NextRequest): string {
    const ip = this.getClientIP(request);
    const userAgent = request.headers.get('user-agent') || 'unknown';
    return `${ip}:${userAgent}`;
  }

  // Get client IP address
  private static getClientIP(request: NextRequest): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const realIP = request.headers.get('x-real-ip');
    const remoteAddr = request.headers.get('remote-addr');
    
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    
    return realIP || remoteAddr || 'unknown';
  }

  // Apply rate limiting
  static async limit(
    request: NextRequest,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    try {
      const keyGenerator = config.keyGenerator || this.defaultKeyGenerator;
      const key = keyGenerator(request);
      
      const data = await this.store.increment(key, config.windowMs);
      const remaining = Math.max(0, config.maxRequests - data.count);
      const resetTime = new Date(data.resetTime);

      if (data.count > config.maxRequests) {
        return {
          success: false,
          limit: config.maxRequests,
          remaining: 0,
          resetTime,
          error: config.message || 'Too many requests. Please try again later.'
        };
      }

      return {
        success: true,
        limit: config.maxRequests,
        remaining,
        resetTime
      };

    } catch (error: any) {
      console.error('Rate limiting error:', error);
      
      // If rate limiting fails, allow the request
      return {
        success: true,
        limit: config.maxRequests,
        remaining: config.maxRequests,
        resetTime: new Date(Date.now() + config.windowMs)
      };
    }
  }

 // Predefined rate limiters
static async limitSMSOTP(request: NextRequest): Promise<RateLimitResult> {
  return this.limit(request, {
   windowMs: RATE_LIMITS.FILE_UPLOAD.WINDOW_MS, // Use windowMs
    maxRequests: RATE_LIMITS.FILE_UPLOAD.MAX_REQUESTS, // Use maxRequests
    keyGenerator: (req) => {
      const ip = this.getClientIP(req);
      return `sms_otp:${ip}`;
    },
    message: 'Too many OTP requests. Please wait before requesting another.'
  });
}

static async limitLoginAttempts(request: NextRequest): Promise<RateLimitResult> {
  return this.limit(request, {
   windowMs: RATE_LIMITS.FILE_UPLOAD.WINDOW_MS, // Use windowMs
    maxRequests: RATE_LIMITS.FILE_UPLOAD.MAX_REQUESTS, // Use maxRequests
    keyGenerator: (req) => {
      const ip = this.getClientIP(req);
      return `login:${ip}`;
    },
    message: 'Too many login attempts. Please try again later.'
  });
}

static async limitMessageSending(request: NextRequest, userId: string): Promise<RateLimitResult> {
  return this.limit(request, {
   windowMs: RATE_LIMITS.FILE_UPLOAD.WINDOW_MS, // Use windowMs
    maxRequests: RATE_LIMITS.FILE_UPLOAD.MAX_REQUESTS, // Use maxRequests
    keyGenerator: () => `messages:${userId}`,
    message: 'You are sending messages too quickly. Please slow down.'
  });
}

static async limitFileUpload(request: NextRequest, userId: string): Promise<RateLimitResult> {
  return this.limit(request, {
    windowMs: RATE_LIMITS.FILE_UPLOAD.WINDOW_MS, // Use windowMs
    maxRequests: RATE_LIMITS.FILE_UPLOAD.MAX_REQUESTS, // Use maxRequests
    keyGenerator: () => `upload:${userId}`,
    message: 'Too many file uploads. Please wait before uploading again.'
  });
}

static async limitGeneralAPI(request: NextRequest): Promise<RateLimitResult> {
  return this.limit(request, {
   windowMs: RATE_LIMITS.FILE_UPLOAD.WINDOW_MS, // Use windowMs
    maxRequests: RATE_LIMITS.FILE_UPLOAD.MAX_REQUESTS, // Use maxRequests
    keyGenerator: (req) => {
      const ip = this.getClientIP(req);
      return `api:${ip}`;
    },
    message: 'API rate limit exceeded. Please slow down your requests.'
  });
}

  // Create custom rate limiter for specific user actions
  static async limitUserAction(
    request: NextRequest,
    userId: string,
    action: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    return this.limit(request, {
      windowMs,
      maxRequests,
      keyGenerator: () => `${action}:${userId}`,
      message: `Too many ${action} requests. Please wait before trying again.`
    });
  }

  // Reset rate limit for specific key
  static async reset(key: string): Promise<void> {
    // This would delete the key from the store
    // Implementation depends on the store type (memory, Redis, etc.)
  }

  // Get current rate limit status
  static async getStatus(
    request: NextRequest,
    config: RateLimitConfig
  ): Promise<{ count: number; remaining: number; resetTime: Date }> {
    const keyGenerator = config.keyGenerator || this.defaultKeyGenerator;
    const key = keyGenerator(request);
    
    const data = await this.store.get(key);
    
    if (!data) {
      return {
        count: 0,
        remaining: config.maxRequests,
        resetTime: new Date(Date.now() + config.windowMs)
      };
    }

    return {
      count: data.count,
      remaining: Math.max(0, config.maxRequests - data.count),
      resetTime: new Date(data.resetTime)
    };
  }
}

// Convenience function for simple rate limiting
export async function rateLimit(
  request: NextRequest,
  config: RateLimitConfig = {
    windowMs: RATE_LIMITS.API_GENERAL.WINDOW_MS,
    maxRequests: RATE_LIMITS.API_GENERAL.MAX_REQUESTS
  }
): Promise<RateLimitResult> {
  return RateLimiter.limit(request, config);
}