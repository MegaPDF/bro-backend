import { NextRequest, NextResponse } from 'next/server';
import { AuthConfigService } from '@/lib/auth/config';

// GET /api/auth/config - Get public auth configuration for clients
export async function GET(request: NextRequest) {
  try {
    // Get auth configuration
    const authConfig = await AuthConfigService.getInstance().getConfig();

    // Return only client-safe configuration
    const publicConfig = {
      otp: {
        length: authConfig.otp.length,
        expiryMinutes: authConfig.otp.expiryMinutes,
        resendCooldownSeconds: authConfig.otp.resendCooldownSeconds
      },
      security: {
        maxLoginAttempts: authConfig.security.maxLoginAttempts,
        lockoutDurationMinutes: authConfig.security.lockoutDurationMinutes,
        requireTwoFactor: authConfig.security.requireTwoFactor,
        allowedDevicesPerUser: authConfig.security.allowedDevicesPerUser
      },
      qr: {
        sessionExpiryMinutes: authConfig.qr.sessionExpiryMinutes,
        maxConcurrentSessions: authConfig.qr.maxConcurrentSessions
      },
      rateLimiting: {
        login: {
          windowMinutes: Math.floor(authConfig.rateLimiting.login.windowMs / 60000),
          maxAttempts: authConfig.rateLimiting.login.maxAttempts
        },
        otp: {
          windowMinutes: Math.floor(authConfig.rateLimiting.otp.windowMs / 60000),
          maxAttempts: authConfig.rateLimiting.otp.maxAttempts
        }
      }
    };

    return NextResponse.json({
      success: true,
      data: publicConfig,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Get public auth config error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to get auth configuration'
    }, { status: 500 });
  }
}
