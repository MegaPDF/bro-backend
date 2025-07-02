import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import { ERROR_CODES, SUCCESS_MESSAGES } from '@/lib/utils/constants';
import { ErrorHelpers } from '@/lib/utils/helpers';
import jwt from 'jsonwebtoken';
import type { JWTPayload } from '@/types/auth';
import type { APIResponse } from '@/types/api';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();

    // Get authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.UNAUTHORIZED,
        message: 'Authorization token required',
        code: ERROR_CODES.UNAUTHORIZED,
        timestamp: new Date()
      } as APIResponse, { status: 401 });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token
    let decoded: JWTPayload;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
    } catch (error: any) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.INVALID_TOKEN,
        message: 'Invalid or expired token',
        code: ERROR_CODES.INVALID_TOKEN,
        timestamp: new Date()
      } as APIResponse, { status: 401 });
    }

    // Find user
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.USER_NOT_FOUND,
        message: 'User not found',
        code: ERROR_CODES.USER_NOT_FOUND,
        timestamp: new Date()
      } as APIResponse, { status: 404 });
    }

    // Get logout option from request body (optional)
    const body = await request.json().catch(() => ({}));
    const { logoutFromAllDevices = false } = body;

    if (logoutFromAllDevices) {
      // Mark all devices as inactive and clear push tokens
      user.devices.forEach((device: any) => {
        device.isActive = false;
        device.pushToken = undefined;
        device.fcmToken = undefined;
        device.apnsToken = undefined;
      });
    } else {
      // Only logout from current device
      const deviceIndex = user.devices.findIndex(
        (device: any) => device.deviceId === decoded.deviceId
      );
      
      if (deviceIndex >= 0) {
        user.devices[deviceIndex].isActive = false;
        user.devices[deviceIndex].pushToken = undefined;
        user.devices[deviceIndex].fcmToken = undefined;
        user.devices[deviceIndex].apnsToken = undefined;
      }
    }

    // Check if user should be marked as offline
    const hasActiveDevices = user.devices.some((device: any) => device.isActive);
    if (!hasActiveDevices) {
      user.isOnline = false;
      user.lastSeen = new Date();
    }

    await user.save();

    // Track logout event
    await analyticsTracker.trackFeatureUsage(
      user._id.toString(),
      'auth',
      'logout_success',
      {
        deviceId: decoded.deviceId,
        logoutFromAllDevices,
        hasActiveDevices
      }
    );

    // Track user activity
    await analyticsTracker.trackUserActivity(
      user._id.toString(),
      'user_logout',
      {
        deviceId: decoded.deviceId,
        logoutFromAllDevices
      }
    );

    // Return success response
    return NextResponse.json({
      success: true,
      data: {
        success: true,
        message: logoutFromAllDevices 
          ? 'Logged out from all devices successfully'
          : 'Logged out successfully',
        loggedOutFromAllDevices: logoutFromAllDevices
      },
      message: logoutFromAllDevices 
        ? 'Logged out from all devices successfully'
        : 'Logged out successfully',
      timestamp: new Date()
    } as APIResponse, { status: 200 });

  } catch (error: any) {
    console.error('Logout error:', error);

    await analyticsTracker.trackError(error, 'system', {
      component: 'auth_logout',
      action: 'logout'
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