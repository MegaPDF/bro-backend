import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { QRCodeService } from '@/lib/utils/qr-generator';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import { ERROR_CODES, JWT_CONFIG } from '@/lib/utils/constants';
import { ErrorHelpers } from '@/lib/utils/helpers';
import type { QRCodeResponse } from '@/types/auth';
import type { APIResponse } from '@/types/api';

// In-memory storage for QR sessions (in production, use Redis)
const qrSessions = new Map<string, {
  sessionId: string;
  token: string;
  expiresAt: Date;
  isUsed: boolean;
  userId?: string;
  deviceInfo?: any;
}>();

// Clean up expired sessions periodically
setInterval(() => {
  const now = new Date();
  for (const [sessionId, session] of qrSessions.entries()) {
    if (session.expiresAt < now) {
      qrSessions.delete(sessionId);
    }
  }
}, 60000); // Clean up every minute

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();

    // Get device info from headers
    const userAgent = request.headers.get('user-agent') || '';
    const clientIp = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown';

    const deviceInfo = {
      userAgent,
      ip: clientIp
    };

    // Generate QR code for authentication
    const qrResult = await QRCodeService.generateAuthQR(deviceInfo);

    // Store session in memory (in production, use Redis with expiration)
    qrSessions.set(qrResult.sessionId, {
      sessionId: qrResult.sessionId,
      token: qrResult.token,
      expiresAt: qrResult.expiresAt,
      isUsed: false,
      deviceInfo
    });

    // Track QR generation
    await analyticsTracker.trackFeatureUsage(
      'system',
      'auth',
      'qr_generated',
      {
        sessionId: qrResult.sessionId,
        clientIp,
        userAgent: userAgent.substring(0, 100) // Truncate for storage
      }
    );

    // Create response
    const response: QRCodeResponse = {
      qrToken: qrResult.token,
      qrCodeUrl: qrResult.qrCodeUrl,
      expiresIn: 5 * 60 // 5 minutes in seconds
    };

    return NextResponse.json({
      success: true,
      data: response,
      message: 'QR code generated successfully',
      timestamp: new Date()
    } as APIResponse<QRCodeResponse>, { status: 200 });

  } catch (error: any) {
    console.error('QR generate error:', error);

    await analyticsTracker.trackError(error, 'system', {
      component: 'auth_qr_generate',
      action: 'generate_qr'
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Check QR session status
    const body = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: 'Session ID required',
        code: ERROR_CODES.VALIDATION_ERROR,
        timestamp: new Date()
      } as APIResponse, { status: 400 });
    }

    const session = qrSessions.get(sessionId);

    if (!session) {
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.INVALID_TOKEN,
        message: 'Invalid or expired session',
        code: ERROR_CODES.INVALID_TOKEN,
        timestamp: new Date()
      } as APIResponse, { status: 404 });
    }

    // Check if session is expired
    if (session.expiresAt < new Date()) {
      qrSessions.delete(sessionId);
      return NextResponse.json({
        success: false,
        error: ERROR_CODES.TOKEN_EXPIRED,
        message: 'QR session has expired',
        code: ERROR_CODES.TOKEN_EXPIRED,
        timestamp: new Date()
      } as APIResponse, { status: 410 });
    }

    // Return session status
    return NextResponse.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        isUsed: session.isUsed,
        userId: session.userId,
        expiresAt: session.expiresAt
      },
      message: 'Session status retrieved',
      timestamp: new Date()
    } as APIResponse, { status: 200 });

  } catch (error: any) {
    console.error('QR session check error:', error);

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

// Export the qrSessions for use in QR verify endpoint
export { qrSessions };