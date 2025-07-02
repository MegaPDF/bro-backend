import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { registerSchema } from '@/lib/validations/auth';
import { otpService } from '@/lib/services/otp/otp-service';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import { ERROR_CODES, SUCCESS_MESSAGES, JWT_CONFIG } from '@/lib/utils/constants';
import { ErrorHelpers } from '@/lib/utils/helpers';
import jwt from 'jsonwebtoken';
import type { RegisterRequest, AuthResponse, AuthUser } from '@/types/auth';
import type { APIResponse } from '@/types/api';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();

    // Parse and validate request body
    const body: RegisterRequest = await request.json();
    const validation = registerSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: validation.error.errors[0].message,
        code: ERROR_CODES.VALIDATION_ERROR,
        timestamp: new Date()
      } as APIResponse, { status: 400 });
    }

    const { phoneNumber, countryCode, displayName, email, username } = validation.data;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { phoneNumber, countryCode },
        ...(email ? [{ email }] : []),
        ...(username ? [{ username }] : [])
      ]
    });

    if (existingUser) {
      let conflictField = 'phone number';
      if (existingUser.email === email) conflictField = 'email';
      if (existingUser.username === username) conflictField = 'username';

      await analyticsTracker.trackFeatureUsage(
        'system',
        'auth',
        'registration_failed',
        {
          phoneNumber: otpService.maskPhoneNumber(phoneNumber),
          reason: 'user_exists',
          conflictField
        }
      );

      return NextResponse.json({
        success: false,
        error: ERROR_CODES.USER_ALREADY_EXISTS,
        message: `User with this ${conflictField} already exists`,
        code: ERROR_CODES.USER_ALREADY_EXISTS,
        timestamp: new Date()
      } as APIResponse, { status: 409 });
    }

    // Get device info from headers
    const deviceId = request.headers.get('x-device-id') || 'unknown';
    const deviceName = request.headers.get('x-device-name') || 'Unknown Device';
    const platform = request.headers.get('x-platform') || 'web';
    const appVersion = request.headers.get('x-app-version') || '1.0.0';
    const userAgent = request.headers.get('user-agent') || '';
    const pushToken = request.headers.get('x-push-token');
    const clientIp = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown';

    // Create new user
    const newUser = new User({
      phoneNumber,
      countryCode,
      displayName: displayName.trim(),
      email: email || undefined,
      username: username || undefined,
      isVerified: false,
      isOnline: true,
      lastSeen: new Date(),
      status: 'active',
      devices: [{
        deviceId,
        deviceName,
        platform,
        appVersion,
        lastActive: new Date(),
        pushToken,
        userAgent,
        isActive: true
      }],
      accountCreatedFrom: {
        platform,
        version: appVersion,
        ip: clientIp
      },
      // Set default settings
      privacySettings: {
        lastSeen: 'everyone',
        profilePhoto: 'everyone',
        about: 'everyone',
        readReceipts: true,
        groups: 'everyone',
        calls: 'everyone',
        status: 'contacts'
      },
      securitySettings: {
        twoFactorEnabled: false,
        backupEnabled: true,
        disappearingMessages: 0,
        fingerprintLock: false,
        autoDownloadMedia: true
      },
      notificationSettings: {
        messageNotifications: true,
        groupNotifications: true,
        callNotifications: true,
        statusNotifications: true,
        sound: 'default',
        vibration: true,
        popupNotification: true
      }
    });

    await newUser.save();

    // Generate JWT tokens
    const jwtPayload = {
      userId: newUser._id.toString(),
      phoneNumber: newUser.phoneNumber,
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
      _id: newUser._id.toString(),
      phoneNumber: newUser.phoneNumber,
      countryCode: newUser.countryCode,
      displayName: newUser.displayName,
      username: newUser.username,
      avatar: newUser.avatar,
      isVerified: newUser.isVerified,
      status: newUser.status
    };

    // Track successful registration
    await analyticsTracker.trackFeatureUsage(
      newUser._id.toString(),
      'auth',
      'registration_success',
      {
        phoneNumber: otpService.maskPhoneNumber(phoneNumber),
        platform,
        deviceId,
        hasEmail: !!email,
        hasUsername: !!username
      }
    );

    // Track user creation for analytics
    await analyticsTracker.trackUserActivity(
      newUser._id.toString(),
      'user_created',
      {
        platform,
        deviceId,
        registrationMethod: 'phone'
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
      message: SUCCESS_MESSAGES.USER_CREATED,
      timestamp: new Date()
    } as APIResponse<AuthResponse>, { status: 201 });

  } catch (error: any) {
    console.error('Registration error:', error);

    await analyticsTracker.trackError(error, 'system', {
      component: 'auth_register',
      action: 'register'
    });

    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.USER_ALREADY_EXISTS,
        message: `User with this ${field} already exists`,
        code: ERROR_CODES.USER_ALREADY_EXISTS,
        timestamp: new Date()
      } as APIResponse, { status: 409 });
    }

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