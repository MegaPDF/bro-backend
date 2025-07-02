import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { resendOTPSchema } from '@/lib/validations/auth';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import { ERROR_CODES, SUCCESS_MESSAGES, OTP_CONFIG } from '@/lib/utils/constants';
import { ErrorHelpers } from '@/lib/utils/helpers';
import type { OTPResponse } from '@/types/auth';
import type { APIResponse } from '@/types/api';
import { otpService } from '@/lib/services/otp/otp-service';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();

    // Parse and validate request body
    const body = await request.json();
    const validation = resendOTPSchema.safeParse(body);

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

    // Check if user exists
    const existingUser = await User.findOne({ phoneNumber, countryCode });
    const isExistingUser = !!existingUser;

    // Get client IP for rate limiting
    const clientIp = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown';

    // Resend OTP using the same delivery method
    const otpResult = await otpService.resendOTP(phoneNumber, 'sms');

    if (!otpResult.success) {
      await analyticsTracker.trackFeatureUsage(
        existingUser?._id?.toString() || 'system',
        'otp',
        'resend_failed',
        {
          phoneNumber:  otpService.maskPhoneNumber(phoneNumber),
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
        message: otpResult.error || 'Failed to resend OTP',
        code: otpResult.error,
        timestamp: new Date()
      } as APIResponse, { status: statusCode });
    }

    // Track successful OTP resend
    await analyticsTracker.trackFeatureUsage(
      existingUser?._id?.toString() || 'system',
      'otp',
      'resend_success',
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
      message: 'OTP resent successfully',
      userId: otpResult.otpId || 'temporary',
      expiresIn: OTP_CONFIG.EXPIRY_MINUTES * 60 // Convert to seconds
    };

    return NextResponse.json({
      success: true,
      data: response,
      message: 'OTP resent successfully',
      timestamp: new Date()
    } as APIResponse<OTPResponse>, { status: 200 });

  } catch (error: any) {
    console.error('Resend OTP error:', error);

    await analyticsTracker.trackError(error, 'system', {
      component: 'auth_resend_otp',
      action: 'resend_otp'
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