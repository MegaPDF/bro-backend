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

    const { method, phoneNumber, countryCode, email } = validation.data;

    // Determine identifier and delivery info based on method
    let identifier: string;
    let deliveryInfo: OTPDeliveryInfo;

    if (method === 'phone') {
      identifier = phoneNumber!;
      deliveryInfo = {
        method: 'phone',
        phoneNumber: phoneNumber!,
        countryCode: countryCode!
      };
    } else {
      identifier = email!;
      deliveryInfo = {
        method: 'email',
        email: email!
      };
    }

    // Check if user exists (for analytics and user name)
    const existingUser = await (method === 'phone' 
      ? User.findOne({ phoneNumber, countryCode })
      : User.findOne({ email }));
    
    if (existingUser) {
      deliveryInfo.userName = existingUser.displayName;
    }

    // Generate and send OTP
    const otpResult = await otpService.generateOTP(
      identifier,
      method,
      deliveryInfo,
      {
        maxAttempts: OTP_CONFIG.MAX_ATTEMPTS,
        method
      }
    );

    if (!otpResult.success) {
      await analyticsTracker.trackFeatureUsage(
        existingUser?._id?.toString() || 'system',
        'otp',
        'send_failed',
        {
          identifier: method === 'phone' 
            ? otpService.maskPhoneNumber(phoneNumber!) 
            : email!.replace(/(.{3}).*@/, '$1***@'),
          method,
          reason: otpResult.error,
          isExistingUser: !!existingUser
        }
      );

      let statusCode = 500;
      if (otpResult.error === ERROR_CODES.RATE_LIMIT_EXCEEDED) {
        statusCode = 429;
      }

      return NextResponse.json({
        success: false,
        error: otpResult.error,
        message: otpResult.error || `Failed to send OTP via ${method}`,
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
        identifier: method === 'phone' 
          ? otpService.maskPhoneNumber(phoneNumber!) 
          : email!.replace(/(.{3}).*@/, '$1***@'),
        method,
        deliveryMethod: method === 'phone' ? 'sms' : 'email',
        isExistingUser: !!existingUser
      }
    );

    // Create response
    const response: OTPResponse = {
      success: true,
      message: `OTP sent successfully via ${method}`,
      userId: otpResult.otpId || 'temporary',
      expiresIn: OTP_CONFIG.EXPIRY_MINUTES * 60,
      method // Add method to response
    };

    return NextResponse.json({
      success: true,
      data: response,
      message: `OTP sent successfully via ${method}`,
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