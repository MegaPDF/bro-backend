
import { AuthConfigService } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connection';
import { authWithAdmin } from '@/lib/auth/middleware';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/admin/auth-settings - Get current auth configuration
export async function GET(request: NextRequest) {
  try {
    await connectDB();
    
    // Check admin authentication
    const authResult = await authWithAdmin(request, {
      requiredPermissions: ['settings.read']
    });
    
    if (!authResult.success) {
      return authResult.response;
    }

    // Get current auth configuration
    const authConfig = await AuthConfigService.getInstance().getConfig();

    // Remove sensitive data before sending to client
    const safeConfig = {
      jwt: {
        accessTokenExpiry: authConfig.jwt.accessTokenExpiry,
        refreshTokenExpiry: authConfig.jwt.refreshTokenExpiry,
        qrTokenExpiry: authConfig.jwt.qrTokenExpiry,
        adminTokenExpiry: authConfig.jwt.adminTokenExpiry,
        issuer: authConfig.jwt.issuer,
        audience: authConfig.jwt.audience
        // Don't expose secrets
      },
      otp: authConfig.otp,
      qr: authConfig.qr,
      security: {
        bcryptRounds: authConfig.security.bcryptRounds,
        maxLoginAttempts: authConfig.security.maxLoginAttempts,
        lockoutDurationMinutes: authConfig.security.lockoutDurationMinutes,
        sessionTimeoutMinutes: authConfig.security.sessionTimeoutMinutes,
        requireTwoFactor: authConfig.security.requireTwoFactor,
        allowedDevicesPerUser: authConfig.security.allowedDevicesPerUser
      },
      rateLimiting: authConfig.rateLimiting,
      admin: authConfig.admin
    };

    return NextResponse.json({
      success: true,
      data: safeConfig,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Get auth settings error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to get auth settings',
      message: error.message
    }, { status: 500 });
  }
}

// PUT /api/admin/auth-settings - Update auth configuration
export async function PUT(request: NextRequest) {
  try {
    await connectDB();
    
    // Check admin authentication
    const authResult = await authWithAdmin(request, {
      requiredPermissions: ['settings.write']
    });
    
    if (!authResult.success) {
      return authResult.response;
    }

    const updates = await request.json();
    const { admin } = authResult;

    // Validate updates
    const validationResult = validateAuthSettingsUpdate(updates);
    if (!validationResult.isValid) {
      return NextResponse.json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid configuration values',
        details: validationResult.errors
      }, { status: 400 });
    }

    // Update configuration
    await AuthConfigService.getInstance().updateConfig(updates, admin._id.toString());

    // Log the change
    console.log(`Auth settings updated by admin ${admin.username}:`, {
      adminId: admin._id,
      updates: Object.keys(updates),
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      message: 'Auth settings updated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Update auth settings error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to update auth settings',
      message: error.message
    }, { status: 500 });
  }
}

// Validation function for auth settings updates
function validateAuthSettingsUpdate(updates: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate JWT settings
  if (updates.jwt) {
    if (updates.jwt.accessTokenExpiry && !isValidDuration(updates.jwt.accessTokenExpiry)) {
      errors.push('Invalid JWT access token expiry format');
    }
    if (updates.jwt.refreshTokenExpiry && !isValidDuration(updates.jwt.refreshTokenExpiry)) {
      errors.push('Invalid JWT refresh token expiry format');
    }
    if (updates.jwt.qrTokenExpiry && !isValidDuration(updates.jwt.qrTokenExpiry)) {
      errors.push('Invalid JWT QR token expiry format');
    }
    if (updates.jwt.adminTokenExpiry && !isValidDuration(updates.jwt.adminTokenExpiry)) {
      errors.push('Invalid JWT admin token expiry format');
    }
  }

  // Validate OTP settings
  if (updates.otp) {
    if (updates.otp.length && (updates.otp.length < 4 || updates.otp.length > 8)) {
      errors.push('OTP length must be between 4 and 8 digits');
    }
    if (updates.otp.expiryMinutes && (updates.otp.expiryMinutes < 1 || updates.otp.expiryMinutes > 60)) {
      errors.push('OTP expiry must be between 1 and 60 minutes');
    }
    if (updates.otp.maxAttempts && (updates.otp.maxAttempts < 1 || updates.otp.maxAttempts > 10)) {
      errors.push('OTP max attempts must be between 1 and 10');
    }
  }

  // Validate security settings
  if (updates.security) {
    if (updates.security.bcryptRounds && (updates.security.bcryptRounds < 8 || updates.security.bcryptRounds > 15)) {
      errors.push('Bcrypt rounds must be between 8 and 15');
    }
    if (updates.security.maxLoginAttempts && (updates.security.maxLoginAttempts < 1 || updates.security.maxLoginAttempts > 20)) {
      errors.push('Max login attempts must be between 1 and 20');
    }
    if (updates.security.sessionTimeoutMinutes && (updates.security.sessionTimeoutMinutes < 5 || updates.security.sessionTimeoutMinutes > 1440)) {
      errors.push('Session timeout must be between 5 minutes and 24 hours');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Helper function to validate duration format (e.g., "1h", "30m", "7d")
function isValidDuration(duration: string): boolean {
  const durationRegex = /^(\d+)([smhd])$/;
  return durationRegex.test(duration);
}
