import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { AuthConfigService } from '@/lib/auth/config';
import { JWTService } from '@/lib/auth/jwt';
import { ERROR_CODES } from '@/lib/utils/constants';

export interface AuthenticatedRequest extends NextRequest {
  user: any;
  userId: string;
  deviceId: string;
  authConfig: any;
}

export async function authMiddleware(
  request: NextRequest,
  options: { requireVerified?: boolean } = {}
): Promise<{ success: true; user: any; userId: string; deviceId: string; authConfig: any } | { success: false; response: NextResponse }> {
  try {
    await connectDB();

    // Get dynamic auth configuration
    const authConfig = await AuthConfigService.getInstance().getConfig();

    // Get authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.UNAUTHORIZED,
          message: 'Authorization token required'
        }, { status: 401 })
      };
    }

    const token = authHeader.substring(7);

    // Verify JWT token using database config
    const jwtService = JWTService.getInstance();
    const decoded = await jwtService.verifyAccessToken(token);

    if (!decoded) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.INVALID_TOKEN,
          message: 'Invalid or expired token'
        }, { status: 401 })
      };
    }

    // Get user
    const user = await User.findById(decoded.userId);
    if (!user) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.USER_NOT_FOUND,
          message: 'User not found'
        }, { status: 404 })
      };
    }

    // Check user status
    if (user.status !== 'active') {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.USER_BLOCKED,
          message: 'User account is not active'
        }, { status: 403 })
      };
    }

    // Check if verification is required
    if (options.requireVerified && !user.isVerified) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: 'USER_NOT_VERIFIED',
          message: 'Please verify your phone number first'
        }, { status: 403 })
      };
    }

    // Check session timeout using database config
    const sessionTimeout = authConfig.security.sessionTimeoutMinutes * 60 * 1000;
    if (new Date().getTime() - user.lastSeen.getTime() > sessionTimeout) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: 'SESSION_EXPIRED',
          message: 'Session has expired. Please login again'
        }, { status: 401 })
      };
    }

    // Update user activity
    user.lastSeen = new Date();
    user.isOnline = true;
    await user.save();

    return {
      success: true,
      user,
      userId: decoded.userId,
      deviceId: decoded.deviceId,
      authConfig
    };

  } catch (error: any) {
    console.error('Auth middleware error:', error);
    return {
      success: false,
      response: NextResponse.json({
        success: false,
        error: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: 'Authentication failed'
      }, { status: 500 })
    };
  }
}