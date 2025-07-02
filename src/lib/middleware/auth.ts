// src/lib/middleware/auth.ts
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { ERROR_CODES } from '@/lib/utils/constants';
import jwt from 'jsonwebtoken';
import type { JWTPayload, AuthUser } from '@/types/auth';
import type { APIResponse } from '@/types/api';

export interface AuthenticatedRequest extends NextRequest {
  user: AuthUser;
  userId: string;
  deviceId: string;
}

export interface AuthMiddlewareOptions {
  requireVerified?: boolean;
  allowedRoles?: string[];
  requireActiveDevice?: boolean;
}

/**
 * Authentication middleware for API routes
 */
export async function authMiddleware(
  request: NextRequest,
  options: AuthMiddlewareOptions = {}
): Promise<{ success: true; user: AuthUser; userId: string; deviceId: string } | { success: false; response: NextResponse }> {
  try {
    await connectDB();

    // Get authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.UNAUTHORIZED,
          message: 'Authorization token required',
          code: ERROR_CODES.UNAUTHORIZED,
          timestamp: new Date()
        } as APIResponse, { status: 401 })
      };
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token
    let decoded: JWTPayload;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
    } catch (error: any) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.INVALID_TOKEN,
          message: 'Invalid or expired token',
          code: ERROR_CODES.INVALID_TOKEN,
          timestamp: new Date()
        } as APIResponse, { status: 401 })
      };
    }

    // Find user and verify they exist and are active
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.USER_NOT_FOUND,
          message: 'User not found',
          code: ERROR_CODES.USER_NOT_FOUND,
          timestamp: new Date()
        } as APIResponse, { status: 404 })
      };
    }

    // Check user status
    if (user.status !== 'active') {
      let errorCode: string = ERROR_CODES.USER_NOT_FOUND;
      let message = 'User account is not active';

      if (user.status === 'blocked') {
        errorCode = ERROR_CODES.USER_BLOCKED;
        message = 'Account has been blocked';
      } else if (user.status === 'suspended') {
        errorCode = ERROR_CODES.USER_SUSPENDED;
        message = 'Account has been suspended';
      }

      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: errorCode,
          message,
          code: errorCode,
          timestamp: new Date()
        } as APIResponse, { status: 403 })
      };
    }

    // Check if verification is required
    if (options.requireVerified && !user.isVerified) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.FORBIDDEN,
          message: 'Account verification required',
          code: ERROR_CODES.FORBIDDEN,
          timestamp: new Date()
        } as APIResponse, { status: 403 })
      };
    }

    // Check device status if required
    if (options.requireActiveDevice) {
      const device = user.devices.find((d: any) => d.deviceId === decoded.deviceId);
      if (!device || !device.isActive) {
        return {
          success: false,
          response: NextResponse.json({
            success: false,
            error: ERROR_CODES.UNAUTHORIZED,
            message: 'Device not authorized',
            code: ERROR_CODES.UNAUTHORIZED,
            timestamp: new Date()
          } as APIResponse, { status: 401 })
        };
      }

      // Update device last active
      device.lastActive = new Date();
      await user.save();
    }

    // Create auth user object
    const authUser: AuthUser = {
      _id: user._id.toString(),
      phoneNumber: user.phoneNumber,
      countryCode: user.countryCode,
      displayName: user.displayName,
      username: user.username,
      avatar: user.avatar,
      isVerified: user.isVerified,
      status: user.status
    };

    return {
      success: true,
      user: authUser,
      userId: decoded.userId,
      deviceId: decoded.deviceId
    };

  } catch (error: any) {
    console.error('Auth middleware error:', error);
    
    return {
      success: false,
      response: NextResponse.json({
        success: false,
        error: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: 'Authentication failed',
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        timestamp: new Date()
      } as APIResponse, { status: 500 })
    };
  }
}

/**
 * Higher-order function to protect API routes
 */
export function withAuth(
  handler: (request: NextRequest, context: { user: AuthUser; userId: string; deviceId: string }) => Promise<NextResponse>,
  options: AuthMiddlewareOptions = {}
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const authResult = await authMiddleware(request, options);
    
    if (!authResult.success) {
      return authResult.response;
    }

    return handler(request, {
      user: authResult.user,
      userId: authResult.userId,
      deviceId: authResult.deviceId
    });
  };
}

/**
 * Extract user from token without full middleware (for optional auth)
 */
export async function getUserFromToken(token: string): Promise<AuthUser | null> {
  try {
    await connectDB();

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
    const user = await User.findById(decoded.userId);

    if (!user || user.status !== 'active') {
      return null;
    }

    return {
      _id: user._id.toString(),
      phoneNumber: user.phoneNumber,
      countryCode: user.countryCode,
      displayName: user.displayName,
      username: user.username,
      avatar: user.avatar,
      isVerified: user.isVerified,
      status: user.status
    };

  } catch (error) {
    return null;
  }
}

/**
 * Rate limiting by user ID
 */
const userRateLimits = new Map<string, { count: number; resetTime: number }>();

export function rateLimitByUser(
  userId: string,
  maxRequests: number = 100,
  windowMs: number = 60000 // 1 minute
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const userLimit = userRateLimits.get(userId);

  if (!userLimit || userLimit.resetTime <= now) {
    // Reset or create new limit
    userRateLimits.set(userId, {
      count: 1,
      resetTime: now + windowMs
    });
    
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: now + windowMs
    };
  }

  if (userLimit.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: userLimit.resetTime
    };
  }

  userLimit.count++;
  
  return {
    allowed: true,
    remaining: maxRequests - userLimit.count,
    resetTime: userLimit.resetTime
  };
}

/**
 * Clean up expired rate limits
 */
setInterval(() => {
  const now = Date.now();
  for (const [userId, limit] of userRateLimits.entries()) {
    if (limit.resetTime <= now) {
      userRateLimits.delete(userId);
    }
  }
}, 60000); // Clean up every minute

// Example usage in API routes:
/*
// Simple protection
export const GET = withAuth(async (request, { user, userId }) => {
  // Your protected route logic here
  return NextResponse.json({ message: `Hello ${user.displayName}` });
});

// With additional options
export const POST = withAuth(async (request, { user, userId, deviceId }) => {
  // Rate limiting
  const rateLimit = rateLimitByUser(userId, 10, 60000); // 10 requests per minute
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  // Your protected route logic here
  return NextResponse.json({ success: true });
}, {
  requireVerified: true,
  requireActiveDevice: true
});

// Manual middleware usage
export async function PUT(request: NextRequest) {
  const authResult = await authMiddleware(request, { requireVerified: true });
  
  if (!authResult.success) {
    return authResult.response;
  }

  const { user, userId } = authResult;
  
  // Your route logic here
  return NextResponse.json({ user });
}
*/