
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { AuthConfigService } from '@/lib/auth/config';
import { JWTService } from '@/lib/auth/jwt';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    
    // Get dynamic auth configuration
    const authConfig = await AuthConfigService.getInstance().getConfig();
    
    const { phoneNumber, otp, displayName, deviceInfo } = await request.json();

    // Validate required fields
    if (!phoneNumber || !otp) {
      return NextResponse.json({
        success: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Phone number and OTP are required'
      }, { status: 400 });
    }

    // Find user
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return NextResponse.json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'Invalid phone number or OTP'
      }, { status: 404 });
    }

    // Check if user is locked out
    const maxAttempts = authConfig.security.maxLoginAttempts;
    const lockoutDuration = authConfig.security.lockoutDurationMinutes * 60 * 1000;
    
    if (user.loginAttempts >= maxAttempts) {
      const lockoutExpiry = new Date(user.lastFailedLogin.getTime() + lockoutDuration);
      if (new Date() < lockoutExpiry) {
        const remainingTime = Math.ceil((lockoutExpiry.getTime() - new Date().getTime()) / 60000);
        return NextResponse.json({
          success: false,
          error: 'ACCOUNT_LOCKED',
          message: `Account locked. Try again in ${remainingTime} minutes`
        }, { status: 423 });
      } else {
        // Reset login attempts after lockout period
        user.loginAttempts = 0;
      }
    }

    // Verify OTP
    if (!user.tempOTP || !user.tempOTPExpires) {
      return NextResponse.json({
        success: false,
        error: 'NO_PENDING_OTP',
        message: 'No pending OTP verification'
      }, { status: 400 });
    }

    // Check OTP expiry using database config
    if (new Date() > user.tempOTPExpires) {
      return NextResponse.json({
        success: false,
        error: 'OTP_EXPIRED',
        message: `OTP has expired. Valid for ${authConfig.otp.expiryMinutes} minutes only`
      }, { status: 400 });
    }

    // Verify OTP hash
    const isValidOTP = await bcrypt.compare(otp, user.tempOTP);
    if (!isValidOTP) {
      // Increment failed attempts
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      user.lastFailedLogin = new Date();
      await user.save();

      const remainingAttempts = maxAttempts - user.loginAttempts;
      return NextResponse.json({
        success: false,
        error: 'INVALID_OTP',
        message: remainingAttempts > 0 
          ? `Invalid OTP. ${remainingAttempts} attempts remaining`
          : 'Invalid OTP. Account will be locked'
      }, { status: 400 });
    }

    // OTP is valid - update user
    user.isVerified = true;
    user.tempOTP = undefined;
    user.tempOTPExpires = undefined;
    user.loginAttempts = 0;
    user.lastFailedLogin = undefined;
    user.isOnline = true;
    user.lastSeen = new Date();

    // Update display name if provided (for registration)
    if (displayName && displayName !== phoneNumber) {
      user.displayName = displayName;
    }

    // Add device info using database config
    if (deviceInfo) {
      const maxDevices = authConfig.security.allowedDevicesPerUser;
      
      // Remove oldest device if limit exceeded
      if (user.devices.length >= maxDevices) {
        user.devices.sort((a, b) => a.lastActive.getTime() - b.lastActive.getTime());
        user.devices = user.devices.slice(-(maxDevices - 1));
      }

      // Add new device
      user.devices.push({
        deviceId: deviceInfo.deviceId,
        deviceName: deviceInfo.deviceName || 'Unknown Device',
        platform: deviceInfo.platform || 'web',
        appVersion: deviceInfo.appVersion || '1.0.0',
        lastActive: new Date(),
        pushToken: deviceInfo.pushToken
      });
    }

    await user.save();

    // Generate JWT tokens using database config
    const jwtService = JWTService.getInstance();
    const deviceId = deviceInfo?.deviceId || 'web';

    const accessToken = await jwtService.generateAccessToken(user, deviceId);
    const refreshToken = await jwtService.generateRefreshToken(
      user,
      deviceId,
      deviceInfo
    );

    return NextResponse.json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        user: {
          id: user._id,
          phoneNumber: user.phoneNumber,
          displayName: user.displayName,
          avatar: user.avatar,
          isVerified: user.isVerified
        },
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: authConfig.jwt.accessTokenExpiry
        },
        config: {
          sessionTimeout: authConfig.security.sessionTimeoutMinutes,
          requireTwoFactor: authConfig.security.requireTwoFactor
        }
      }
    });

  } catch (error: any) {
    console.error('Verify OTP error:', error);
    return NextResponse.json({
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to verify OTP'
    }, { status: 500 });
  }
}
