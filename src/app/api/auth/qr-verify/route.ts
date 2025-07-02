import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { qrLoginSchema } from '@/lib/validations/auth';
import { QRCodeService } from '@/lib/utils/qr-generator';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import { ERROR_CODES, JWT_CONFIG } from '@/lib/utils/constants';
import { ErrorHelpers } from '@/lib/utils/helpers';
import jwt from 'jsonwebtoken';
import type { QRLoginRequest, AuthResponse, AuthUser, JWTPayload } from '@/types/auth';
import type { APIResponse } from '@/types/api';

// Import QR sessions from qr-generate (in production, use Redis)
const qrSessions = new Map<string, {
  sessionId: string;
  token: string;
  expiresAt: Date;
  isUsed: boolean;
  userId?: string;
  deviceInfo?: any;
}>();

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();

    // Get authorization header for the user trying to verify
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.UNAUTHORIZED,
        message: 'Authorization token required',
        code: ERROR_CODES.UNAUTHORIZED,
        timestamp: new Date()
      } as APIResponse, { status: 401 });
    }

    const userToken = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify user JWT token
    let userDecoded: JWTPayload;
    try {
      userDecoded = jwt.verify(userToken, process.env.JWT_SECRET!) as JWTPayload;
    } catch (error: any) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.INVALID_TOKEN,
        message: 'Invalid or expired user token',
        code: ERROR_CODES.INVALID_TOKEN,
        timestamp: new Date()
      } as APIResponse, { status: 401 });
    }

    // Parse and validate request body
    const body: QRLoginRequest = await request.json();
    const validation = qrLoginSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: validation.error.errors[0].message,
        code: ERROR_CODES.VALIDATION_ERROR,
        timestamp: new Date()
      } as APIResponse, { status: 400 });
    }

    const { qrToken, deviceInfo } = validation.data;

    // Verify QR token
    let qrData;
    try {
      qrData = QRCodeService.verifyQRToken(qrToken);
    } catch (error: any) {
      await analyticsTracker.trackFeatureUsage(
        userDecoded.userId,
        'auth',
        'qr_verification_failed',
        {
          reason: 'invalid_qr_token',
          error: error.message
        }
      );

      return NextResponse.json({
        success: false,
        error: ERROR_CODES.INVALID_TOKEN,
        message: 'Invalid or expired QR code',
        code: ERROR_CODES.INVALID_TOKEN,
        timestamp: new Date()
      } as APIResponse, { status: 401 });
    }

    // Find QR session
    const session = qrSessions.get(qrData.sessionId);

    if (!session) {
      await analyticsTracker.trackFeatureUsage(
        userDecoded.userId,
        'auth',
        'qr_verification_failed',
        {
          reason: 'session_not_found',
          sessionId: qrData.sessionId
        }
      );

      return NextResponse.json({
        success: false,
        error: ERROR_CODES.INVALID_TOKEN,
        message: 'QR session not found',
        code: ERROR_CODES.INVALID_TOKEN,
        timestamp: new Date()
      } as APIResponse, { status: 404 });
    }

    // Check if session is already used
    if (session.isUsed) {
      await analyticsTracker.trackFeatureUsage(
        userDecoded.userId,
        'auth',
        'qr_verification_failed',
        {
          reason: 'session_already_used',
          sessionId: qrData.sessionId
        }
      );

      return NextResponse.json({
        success: false,
        error: ERROR_CODES.INVALID_TOKEN,
        message: 'QR code has already been used',
        code: ERROR_CODES.INVALID_TOKEN,
        timestamp: new Date()
      } as APIResponse, { status: 410 });
    }

    // Check if session is expired
    if (session.expiresAt < new Date()) {
      qrSessions.delete(qrData.sessionId);

      await analyticsTracker.trackFeatureUsage(
        userDecoded.userId,
        'auth',
        'qr_verification_failed',
        {
          reason: 'session_expired',
          sessionId: qrData.sessionId
        }
      );

      return NextResponse.json({
        success: false,
        error: ERROR_CODES.TOKEN_EXPIRED,
        message: 'QR session has expired',
        code: ERROR_CODES.TOKEN_EXPIRED,
        timestamp: new Date()
      } as APIResponse, { status: 410 });
    }

    // Find the authenticated user
    const user = await User.findById(userDecoded.userId);
    
    if (!user || user.status !== 'active') {
      await analyticsTracker.trackFeatureUsage(
        userDecoded.userId,
        'auth',
        'qr_verification_failed',
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

    // Add new device to user
    const newDeviceId = deviceInfo.deviceId;
    const existingDeviceIndex = user.devices.findIndex(
      (device: any) => device.deviceId === newDeviceId
    );

    if (existingDeviceIndex >= 0) {
      // Update existing device
      user.devices[existingDeviceIndex] = {
        ...user.devices[existingDeviceIndex],
        ...deviceInfo,
        lastActive: new Date(),
        isActive: true
      };
    } else {
      // Add new device
      user.devices.push({
        ...deviceInfo,
        lastActive: new Date(),
        isActive: true
      });
    }

    await user.save();

    // Mark QR session as used and store user info
    session.isUsed = true;
    session.userId = user._id.toString();
    session.deviceInfo = deviceInfo;

    // Generate JWT tokens for the new device
    const jwtPayload = {
      userId: user._id.toString(),
      phoneNumber: user.phoneNumber,
      deviceId: newDeviceId,
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

    // Track successful QR verification
    await analyticsTracker.trackFeatureUsage(
      user._id.toString(),
      'auth',
      'qr_verification_success',
      {
        sessionId: qrData.sessionId,
        deviceId: newDeviceId,
        platform: deviceInfo.platform
      }
    );

    // Track user activity
    await analyticsTracker.trackUserActivity(
      user._id.toString(),
      'qr_login',
      {
        deviceId: newDeviceId,
        platform: deviceInfo.platform,
        sessionId: qrData.sessionId
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
      message: 'QR verification successful',
      timestamp: new Date()
    } as APIResponse<AuthResponse>, { status: 200 });

  } catch (error: any) {
    console.error('QR verify error:', error);

    await analyticsTracker.trackError(error, 'system', {
      component: 'auth_qr_verify',
      action: 'verify_qr'
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