import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { refreshTokenSchema } from '@/lib/validations/auth';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import { ERROR_CODES, JWT_CONFIG } from '@/lib/utils/constants';
import { ErrorHelpers } from '@/lib/utils/helpers';
import jwt from 'jsonwebtoken';
import type { RefreshTokenRequest, AuthResponse, AuthUser, JWTPayload } from '@/types/auth';
import type { APIResponse } from '@/types/api';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();

    // Parse and validate request body
    const body: RefreshTokenRequest = await request.json();
    const validation = refreshTokenSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: validation.error.errors[0].message,
        code: ERROR_CODES.VALIDATION_ERROR,
        timestamp: new Date()
      } as APIResponse, { status: 400 });
    }

    const { refreshToken } = validation.data;

    // Verify refresh token
    let decoded: JWTPayload;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_SECRET!) as JWTPayload;
    } catch (error: any) {
      await analyticsTracker.trackFeatureUsage(
        'system',
        'auth',
        'refresh_failed',
        {
          reason: 'invalid_token',
          error: error.name
        }
      );

      return NextResponse.json({
        success: false,
        error: ERROR_CODES.INVALID_TOKEN,
        message: 'Invalid or expired refresh token',
        code: ERROR_CODES.INVALID_TOKEN,
        timestamp: new Date()
      } as APIResponse, { status: 401 });
    }

    // Find user and verify they still exist and are active
    const user = await User.findById(decoded.userId);
    
    if (!user || user.status !== 'active') {
      await analyticsTracker.trackFeatureUsage(
        decoded.userId,
        'auth',
        'refresh_failed',
        {
          reason: user ? 'user_inactive' : 'user_not_found'
        }
      );

      return NextResponse.json({
        success: false,
        error: ERROR_CODES.USER_NOT_FOUND,
        message: 'User not found or inactive',
        code: ERROR_CODES.USER_NOT_FOUND,
        timestamp: new Date()
      } as APIResponse, { status: 404 });
    }

    // Check if user is blocked or suspended
    if (user.status === 'blocked') {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.USER_BLOCKED,
        message: 'Account has been blocked',
        code: ERROR_CODES.USER_BLOCKED,
        timestamp: new Date()
      } as APIResponse, { status: 403 });
    }

    if (user.status === 'suspended') {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.USER_SUSPENDED,
        message: 'Account has been suspended',
        code: ERROR_CODES.USER_SUSPENDED,
        timestamp: new Date()
      } as APIResponse, { status: 403 });
    }

    // Update device last active time if device exists
    const device = user.devices.find((d: any) => d.deviceId === decoded.deviceId);
    if (device) {
      device.lastActive = new Date();
      await user.save();
    }

    // Generate new JWT tokens
    const jwtPayload = {
      userId: user._id.toString(),
      phoneNumber: user.phoneNumber,
      deviceId: decoded.deviceId,
      iat: Math.floor(Date.now() / 1000)
    };

    const newAccessToken = jwt.sign(jwtPayload, process.env.JWT_SECRET!, {
      expiresIn: JWT_CONFIG.ACCESS_TOKEN_EXPIRY
    });

    const newRefreshToken = jwt.sign(jwtPayload, process.env.JWT_SECRET!, {
      expiresIn: JWT_CONFIG.REFRESH_TOKEN_EXPIRY
    });

    // Create auth user response
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

    // Track successful token refresh
    await analyticsTracker.trackFeatureUsage(
      user._id.toString(),
      'auth',
      'refresh_success',
      {
        deviceId: decoded.deviceId
      }
    );

    // Return success response
    const response: AuthResponse = {
      success: true,
      user: authUser,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: 3600 // 1 hour in seconds
    };

    return NextResponse.json({
      success: true,
      data: response,
      message: 'Token refreshed successfully',
      timestamp: new Date()
    } as APIResponse<AuthResponse>, { status: 200 });

  } catch (error: any) {
    console.error('Refresh token error:', error);

    await analyticsTracker.trackError(error, 'system', {
      component: 'auth_refresh',
      action: 'refresh_token'
    });

    const sanitizedError = ErrorHelpers.sanitizeErrorForClient(
      error,
      process.env.NODE_ENV === 'development'
    );

    return NextResponse.json({
      success: false,
      error: sanitizedError.code,
      message: sanitizedError.message,
      code: sanitizedError.code,
      timestamp: new Date()
    } as APIResponse, { status: 500 });
  }
}