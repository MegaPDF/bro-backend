import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { AuthConfigService } from '@/lib/auth/config';
import { JWTService } from '@/lib/auth/jwt';

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    
    // Get dynamic auth configuration
    const authConfig = await AuthConfigService.getInstance().getConfig();
    
    const { refreshToken } = await request.json();

    if (!refreshToken) {
      return NextResponse.json({
        success: false,
        error: 'MISSING_REFRESH_TOKEN',
        message: 'Refresh token is required'
      }, { status: 400 });
    }

    // Verify refresh token using database config
    const jwtService = JWTService.getInstance();
    const decoded = await jwtService.verifyRefreshToken(refreshToken);

    if (!decoded) {
      return NextResponse.json({
        success: false,
        error: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token'
      }, { status: 401 });
    }

    // Check if user still exists and is active
    const user = await User.findById(decoded.userId);
    if (!user || user.status !== 'active') {
      return NextResponse.json({
        success: false,
        error: 'USER_INACTIVE',
        message: 'User account is inactive'
      }, { status: 401 });
    }

    // Check session timeout using database config
    const sessionTimeout = authConfig.security.sessionTimeoutMinutes * 60 * 1000;
    if (new Date().getTime() - user.lastSeen.getTime() > sessionTimeout) {
      return NextResponse.json({
        success: false,
        error: 'SESSION_EXPIRED',
        message: 'Session has expired. Please login again'
      }, { status: 401 });
    }

    // Update user activity
    user.lastSeen = new Date();
    user.isOnline = true;
    await user.save();

    // Generate new access token using database config
    // Pass user and deviceId as separate arguments
    const newAccessToken = await jwtService.generateAccessToken(user, decoded.deviceId);

    return NextResponse.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        expiresIn: authConfig.jwt.accessTokenExpiry,
        user: {
          id: user._id,
          displayName: user.displayName,
          avatar: user.avatar,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen
        }
      }
    });

  } catch (error: any) {
    console.error('Refresh token error:', error);
    return NextResponse.json({
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to refresh token'
    }, { status: 500 });
  }
}
