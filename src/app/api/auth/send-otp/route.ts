import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { sendOTPSchema } from '@/lib/validations/auth';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import { ERROR_CODES, SUCCESS_MESSAGES, OTP_CONFIG } from '@/lib/utils/constants';
import { ErrorHelpers } from '@/lib/utils/helpers';
import type { OTPResponse } from '@/types/auth';
import type { APIResponse } from '@/types/api';
import { OTPDeliveryInfo, otpService } from '@/lib/services/otp/otp-service';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();

    // Parse and validate request body
    const body = await request.json();
    const validation = sendOTPSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: validation.error.errors[0].message,
        code: ERROR_CODES.VALIDATION_ERROR,
        timestamp: new Date()
      } as APIResponse, { status: 400 });
    }

    const { phoneNumber, countryCode } = validation.data;

    // Rate limiting check (basic implementation)
    const clientIp = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown';

    // Check if user exists (for analytics purposes)
    const existingUser = await User.findOne({ phoneNumber, countryCode });
    const isExistingUser = !!existingUser;

    // Generate and send OTP
    const deliveryInfo: OTPDeliveryInfo = {
  phoneNumber,
  countryCode,
  userName: existingUser?.displayName
};

    const otpResult = await otpService.generateOTP(
      phoneNumber,
      countryCode,
      deliveryInfo,
      {
        maxAttempts: OTP_CONFIG.MAX_ATTEMPTS,
        deliveryMethod: 'sms'
      }
    );

    if (!otpResult.success) {
      await analyticsTracker.trackFeatureUsage(
        existingUser?._id?.toString() || 'system',
        'otp',
        'send_failed',
        {
          phoneNumber: otpService.maskPhoneNumber(phoneNumber),
          reason: otpResult.error,
          isExistingUser,
          clientIp
        }
      );

      let statusCode = 500;
      if (otpResult.error === ERROR_CODES.RATE_LIMIT_EXCEEDED) {
        statusCode = 429;
      }

      return NextResponse.json({
        success: false,
        error: otpResult.error,
        message: otpResult.error || 'Failed to send OTP',
        code: otpResult.error,
        timestamp: new Date()
      } as APIResponse, { status: statusCode });
    }

    // Track successful OTP send
    await analyticsTracker.trackFeatureUsage(
      existingUser?._id?.toString() || 'system',
      'otp',
      'send_success',
      {
        phoneNumber: otpService.maskPhoneNumber(phoneNumber),
        deliveryMethod: 'sms',
        isExistingUser,
        clientIp
      }
    );

    // Create response
    const response: OTPResponse = {
      success: true,
      message: SUCCESS_MESSAGES.OTP_SENT,
      userId: otpResult.otpId || 'temporary',
      expiresIn: OTP_CONFIG.EXPIRY_MINUTES * 60 // Convert to seconds
    };

    return NextResponse.json({
      success: true,
      data: response,
      message: SUCCESS_MESSAGES.OTP_SENT,
      timestamp: new Date()
    } as APIResponse<OTPResponse>, { status: 200 });

  } catch (error: any) {
    console.error('Send OTP error:', error);

    await analyticsTracker.trackError(error, 'system', {
      component: 'auth_send_otp',
      action: 'send_otp'
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