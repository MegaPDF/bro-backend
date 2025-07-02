import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { AuthConfigService } from '@/lib/auth/config';
import { ValidationHelpers } from '@/lib/utils/helpers';
import bcrypt from 'bcryptjs';
import { TwilioSMSService } from '@/lib/services/sms/twilio';

// Rate limiting store (in production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    
    // Get dynamic auth configuration
    const authConfig = await AuthConfigService.getInstance().getConfig();
    
    const { phoneNumber, action = 'login' } = await request.json();

    // Validate phone number
    if (!ValidationHelpers.isValidPhoneNumber(phoneNumber)) {
      return NextResponse.json({
        success: false,
        error: 'INVALID_PHONE_NUMBER',
        message: 'Please provide a valid phone number'
      }, { status: 400 });
    }

    // Check rate limiting using database config
    const clientIP = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
    const rateLimitKey = `otp_${clientIP}_${phoneNumber}`;
    const now = Date.now();
    const rateLimitWindow = authConfig.rateLimiting.otp.windowMs;
    const maxAttempts = authConfig.rateLimiting.otp.maxAttempts;

    const rateLimit = rateLimitStore.get(rateLimitKey);
    if (rateLimit && now < rateLimit.resetTime) {
      if (rateLimit.count >= maxAttempts) {
        return NextResponse.json({
          success: false,
          error: 'RATE_LIMIT_EXCEEDED',
          message: `Too many OTP requests. Try again in ${Math.ceil((rateLimit.resetTime - now) / 1000)} seconds`
        }, { status: 429 });
      }
      rateLimit.count++;
    } else {
      rateLimitStore.set(rateLimitKey, {
        count: 1,
        resetTime: now + rateLimitWindow
      });
    }

    // Find or create user
    let user = await User.findOne({ phoneNumber });
    
    if (action === 'register' && user) {
      return NextResponse.json({
        success: false,
        error: 'USER_ALREADY_EXISTS',
        message: 'User with this phone number already exists'
      }, { status: 409 });
    }

    if (action === 'login' && !user) {
      return NextResponse.json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'No account found with this phone number'
      }, { status: 404 });
    }

    // Check if user has exceeded OTP attempts using database config
    const otpCooldown = authConfig.otp.resendCooldownSeconds * 1000;
    if (user?.tempOTPExpires && new Date().getTime() < user.tempOTPExpires.getTime() + otpCooldown) {
      const remainingTime = Math.ceil(((user.tempOTPExpires.getTime() + otpCooldown) - new Date().getTime()) / 1000);
      return NextResponse.json({
        success: false,
        error: 'OTP_COOLDOWN_ACTIVE',
        message: `Please wait ${remainingTime} seconds before requesting a new OTP`
      }, { status: 429 });
    }

    // Generate OTP using database config
    const otpLength = authConfig.otp.length;
    const otp = Math.floor(Math.random() * Math.pow(10, otpLength)).toString().padStart(otpLength, '0');
    const otpExpiry = new Date(Date.now() + authConfig.otp.expiryMinutes * 60 * 1000);

    // Hash OTP using database config bcrypt rounds
    const hashedOTP = await bcrypt.hash(otp, authConfig.security.bcryptRounds);

    // Create or update user with OTP
    if (!user) {
      user = new User({
        phoneNumber,
        countryCode: phoneNumber.startsWith('+') ? phoneNumber.substring(0, phoneNumber.length - 10) : '+1',
        displayName: phoneNumber, // Temporary, will be updated during registration
        tempOTP: hashedOTP,
        tempOTPExpires: otpExpiry
      });
    } else {
      user.tempOTP = hashedOTP;
      user.tempOTPExpires = otpExpiry;
    }

    await user.save();

    // Send OTP via SMS
    try {
      const twilioService = TwilioSMSService.getInstance();
      await twilioService.sendOTPSMS(phoneNumber, otp);
    } catch (smsError) {
      console.error('SMS sending failed:', smsError);
      // In production, you might want to continue without SMS or use fallback
    }

    return NextResponse.json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        phoneNumber,
        expiresIn: authConfig.otp.expiryMinutes * 60, // seconds
        resendAfter: authConfig.otp.resendCooldownSeconds
      }
    });

  } catch (error: any) {
    console.error('Send OTP error:', error);
    return NextResponse.json({
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to send OTP'
    }, { status: 500 });
  }
}
