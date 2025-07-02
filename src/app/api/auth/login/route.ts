import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { loginSchema } from '@/lib/validations/auth';
import { otpService } from '@/lib/services/otp/otp-service';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import { ERROR_CODES, SUCCESS_MESSAGES, JWT_CONFIG } from '@/lib/utils/constants';
import { ErrorHelpers } from '@/lib/utils/helpers';
import jwt from 'jsonwebtoken';
import type { LoginRequest, AuthResponse, AuthUser } from '@/types/auth';
import type { APIResponse } from '@/types/api';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();

    // Parse and validate request body
    const body: LoginRequest = await request.json();
    const validation = loginSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: validation.error.errors[0].message,
        code: ERROR_CODES.VALIDATION_ERROR,
        timestamp: new Date()
      } as APIResponse, { status: 400 });
    }

    const { phoneNumber, countryCode, otp } = validation.data;

    // Verify OTP
    const otpResult = await otpService.validateOTP(phoneNumber, otp, {
      deleteOnSuccess: true,
      userId: 'login_attempt'
    });

    if (!otpResult.success) {
      await analyticsTracker.trackFeatureUsage(
        'system',
        'auth',
        'login_failed',
        {
          phoneNumber: otpService.maskPhoneNumber(phoneNumber),
          reason: otpResult.error
        }
      );

      return NextResponse.json({
        success: false,
        error: otpResult.error,
        message: 'Invalid or expired OTP',
        code: otpResult.error,
        timestamp: new Date()
      } as APIResponse, { status: 401 });
    }

    // Find user by phone number
    const user = await User.findOne({ 
      phoneNumber, 
      countryCode,
      status: 'active'
    });

    if (!user) {
      await analyticsTracker.trackFeatureUsage(
        'system',
        'auth',
        'login_failed',
        {
          phoneNumber: otpService.maskPhoneNumber(phoneNumber),
          reason: 'user_not_found'
        }
      );

      return NextResponse.json({
        success: false,
        error: ERROR_CODES.USER_NOT_FOUND,
        message: 'User not found. Please register first.',
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

    // Get device info from headers
    const deviceId = request.headers.get('x-device-id') || 'unknown';
    const deviceName = request.headers.get('x-device-name') || 'Unknown Device';
    const platform = request.headers.get('x-platform') || 'web';
    const appVersion = request.headers.get('x-app-version') || '1.0.0';
    const userAgent = request.headers.get('user-agent') || '';
    const pushToken = request.headers.get('x-push-token');

    // Update or add device
    const existingDeviceIndex = user.devices.findIndex(
      (device: any) => device.deviceId === deviceId
    );

    if (existingDeviceIndex >= 0) {
      // Update existing device
      user.devices[existingDeviceIndex] = {
        ...user.devices[existingDeviceIndex],
        lastActive: new Date(),
        pushToken: pushToken || user.devices[existingDeviceIndex].pushToken,
        userAgent
      };
    } else {
      // Add new device
      user.devices.push({
        deviceId,
        deviceName,
        platform,
        appVersion,
        lastActive: new Date(),
        pushToken,
        userAgent,
        isActive: true
      });
    }

    // Update user online status and last seen
    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();

    // Generate JWT tokens
    const jwtPayload = {
      userId: user._id.toString(),
      phoneNumber: user.phoneNumber,
      deviceId,
      iat: Math.floor(Date.now() / 1000)
    };

    const accessToken = jwt.sign(jwtPayload, process.env.JWT_SECRET!, {
      expiresIn: JWT_CONFIG.ACCESS_TOKEN_EXPIRY
    });

    const refreshToken = jwt.sign(jwtPayload, process.env.JWT_SECRET!, {
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

    // Track successful login
    await analyticsTracker.trackFeatureUsage(
      user._id.toString(),
      'auth',
      'login_success',
      {
        phoneNumber: otpService.maskPhoneNumber(phoneNumber),
        platform,
        deviceId
      }
    );

    // Return success response
    const response: AuthResponse = {
      success: true,
      user: authUser,
      accessToken,
      refreshToken,
      expiresIn: 3600 // 1 hour in seconds
    };

    return NextResponse.json({
      success: true,
      data: response,
      message: SUCCESS_MESSAGES.OTP_VERIFIED,
      timestamp: new Date()
    } as APIResponse<AuthResponse>, { status: 200 });

  } catch (error: any) {
    console.error('Login error:', error);

    await analyticsTracker.trackError(error, 'system', {
      component: 'auth_login',
      action: 'login'
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