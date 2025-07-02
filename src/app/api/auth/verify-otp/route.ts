import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { verifyOTPSchema } from '@/lib/validations/auth';
import { otpService } from '@/lib/services/otp/otp-service';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import { ERROR_CODES, SUCCESS_MESSAGES } from '@/lib/utils/constants';
import { ErrorHelpers } from '@/lib/utils/helpers';
import type { VerifyOTPRequest } from '@/types/auth';
import type { APIResponse } from '@/types/api';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();

    // Parse and validate request body
    const body: VerifyOTPRequest = await request.json();
    const validation = verifyOTPSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: validation.error.errors[0].message,
        code: ERROR_CODES.VALIDATION_ERROR,
        timestamp: new Date()
      } as APIResponse, { status: 400 });
    }

    const { userId, otp } = validation.data;

    // Find user by ID or get from OTP storage
    let user = null;
    let phoneNumber = '';

    if (userId !== 'temporary') {
      user = await User.findById(userId);
      if (user) {
        phoneNumber = user.phoneNumber;
      }
    }

    // If no user found or temporary user, we need to get phone from OTP storage
    if (!phoneNumber) {
      // This would require the OTP service to store the phone number with the OTP
      // For now, we'll return an error if userId is invalid
      if (userId === 'temporary') {
        return NextResponse.json({
          success: false,
          error: ERROR_CODES.INVALID_TOKEN,
          message: 'Invalid user ID for OTP verification',
          code: ERROR_CODES.INVALID_TOKEN,
          timestamp: new Date()
        } as APIResponse, { status: 400 });
      }

      return NextResponse.json({
        success: false,
        error: ERROR_CODES.USER_NOT_FOUND,
        message: 'User not found',
        code: ERROR_CODES.USER_NOT_FOUND,
        timestamp: new Date()
      } as APIResponse, { status: 404 });
    }

    // Verify OTP
    const otpResult = await otpService.validateOTP(phoneNumber, otp, {
      deleteOnSuccess: false, // Don't delete yet, might be used for login/register
      userId
    });

    if (!otpResult.success) {
      await analyticsTracker.trackFeatureUsage(
        userId,
        'otp',
        'verification_failed',
        {
          phoneNumber: otpService.maskPhoneNumber(phoneNumber),
          reason: otpResult.error,
          attemptsRemaining: otpResult.attemptsRemaining
        }
      );

      return NextResponse.json({
        success: false,
        error: otpResult.error,
        message: 'Invalid or expired OTP',
        code: otpResult.error,
        attemptsRemaining: otpResult.attemptsRemaining,
        timestamp: new Date()
      } as APIResponse, { status: 401 });
    }

    // Update user phone verification status if user exists
    if (user && !user.phoneVerified) {
      user.phoneVerified = true;
      await user.save();
    }

    // Track successful verification
    await analyticsTracker.trackFeatureUsage(
      userId,
      'otp',
      'verification_success',
      {
        phoneNumber: otpService.maskPhoneNumber(phoneNumber),
        isNewUser: otpResult.isNewUser
      }
    );

    // Return success response
    const response = {
      success: true,
      message: SUCCESS_MESSAGES.OTP_VERIFIED,
      userId: otpResult.userId || userId,
      isNewUser: otpResult.isNewUser,
      phoneVerified: true
    };

    return NextResponse.json({
      success: true,
      data: response,
      message: SUCCESS_MESSAGES.OTP_VERIFIED,
      timestamp: new Date()
    } as APIResponse, { status: 200 });

  } catch (error: any) {
    console.error('Verify OTP error:', error);

    await analyticsTracker.trackError(error, 'system', {
      component: 'auth_verify_otp',
      action: 'verify_otp'
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