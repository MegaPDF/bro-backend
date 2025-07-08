import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import Admin from '@/lib/db/models/Admin';
import { AuthConfigService } from '@/lib/auth/config';
import { JWTService } from '@/lib/auth/jwt';
import { ERROR_CODES } from '@/lib/utils/constants';

export interface AuthenticatedRequest extends NextRequest {
  user: any;
  userId: string;
  deviceId: string;
  authConfig: any;
}

export interface AdminAuthenticatedRequest extends NextRequest {
  admin: any;
  adminId: string;
  sessionId: string;
  authConfig: any;
}

export interface AdminAuthOptions {
  requiredPermissions?: string[];
  requiredRole?: string;
}

export async function authMiddleware(
  request: NextRequest,
  options: { requireVerified?: boolean } = {}
): Promise<{ success: true; user: any; userId: string; deviceId: string; authConfig: any } | { success: false; response: NextResponse }> {
  try {
    await connectDB();

    // Get dynamic auth configuration
    const authConfig = await AuthConfigService.getInstance().getConfig();

    // Get authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.UNAUTHORIZED,
          message: 'Authorization token required'
        }, { status: 401 })
      };
    }

    const token = authHeader.substring(7);

    // Verify JWT token using database config
    const jwtService = JWTService.getInstance();
    const decoded = await jwtService.verifyAccessToken(token);

    if (!decoded) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.INVALID_TOKEN,
          message: 'Invalid or expired token'
        }, { status: 401 })
      };
    }

    // Get user
    const user = await User.findById(decoded.userId);
    if (!user) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.USER_NOT_FOUND,
          message: 'User not found'
        }, { status: 404 })
      };
    }

    // Check user status
    if (user.status !== 'active') {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.USER_BLOCKED,
          message: 'User account is not active'
        }, { status: 403 })
      };
    }

    // Check if verification is required
    if (options.requireVerified && !user.isVerified) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: 'USER_NOT_VERIFIED',
          message: 'Please verify your phone number first'
        }, { status: 403 })
      };
    }

    // Check session timeout using database config
    const sessionTimeout = authConfig.security.sessionTimeoutMinutes * 60 * 1000;
    if (new Date().getTime() - user.lastSeen.getTime() > sessionTimeout) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: 'SESSION_EXPIRED',
          message: 'Session has expired. Please login again'
        }, { status: 401 })
      };
    }

    // Update user activity
    user.lastSeen = new Date();
    user.isOnline = true;
    await user.save();

    return {
      success: true,
      user,
      userId: decoded.userId,
      deviceId: decoded.deviceId,
      authConfig
    };

  } catch (error: any) {
    console.error('Auth middleware error:', error);
    return {
      success: false,
      response: NextResponse.json({
        success: false,
        error: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: 'Authentication failed'
      }, { status: 500 })
    };
  }
}

export async function authWithAdmin(
  request: NextRequest,
  options: AdminAuthOptions = {}
): Promise<{ success: true; admin: any; adminId: string; sessionId: string; authConfig: any } | { success: false; response: NextResponse }> {
  try {
    await connectDB();

    const { requiredPermissions = [], requiredRole } = options;

    // Get dynamic auth configuration
    const authConfig = await AuthConfigService.getInstance().getConfig();

    // Get authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.UNAUTHORIZED,
          message: 'Admin authorization token required'
        }, { status: 401 })
      };
    }

    const token = authHeader.substring(7);

    // Verify admin JWT token
    const jwtService = JWTService.getInstance();
    let decoded;
    
    try {
      decoded = await jwtService.verifyAdminToken(token);
    } catch (error) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.INVALID_TOKEN,
          message: 'Invalid or expired admin token'
        }, { status: 401 })
      };
    }

    if (!decoded || !decoded.adminId) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.INVALID_TOKEN,
          message: 'Invalid admin token payload'
        }, { status: 401 })
      };
    }

    // Get admin user
    const admin = await Admin.findById(decoded.adminId);
    if (!admin) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.USER_NOT_FOUND,
          message: 'Admin user not found'
        }, { status: 404 })
      };
    }

    // Check admin status
    if (!admin.isActive) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.USER_BLOCKED,
          message: 'Admin account is not active'
        }, { status: 403 })
      };
    }

    // Check role requirement
    if (requiredRole && admin.role !== requiredRole) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: ERROR_CODES.FORBIDDEN,
          message: `Required role: ${requiredRole}. Current role: ${admin.role}`
        }, { status: 403 })
      };
    }

    // Check permissions
    if (requiredPermissions.length > 0) {
      const adminPermissions = admin.permissions || {};
      const hasPermissions = requiredPermissions.every(permission => {
        const [category, action] = permission.split('.');
        return adminPermissions[category] && adminPermissions[category][action] === true;
      });

      if (!hasPermissions) {
        return {
          success: false,
          response: NextResponse.json({
            success: false,
            error: ERROR_CODES.FORBIDDEN,
            message: `Missing required permissions: ${requiredPermissions.join(', ')}`
          }, { status: 403 })
        };
      }
    }

    // Check admin session timeout
    const adminSessionTimeout = (authConfig.admin?.sessionTimeoutHours || 8) * 60 * 60 * 1000;
    if (admin.lastLogin && new Date().getTime() - admin.lastLogin.getTime() > adminSessionTimeout) {
      return {
        success: false,
        response: NextResponse.json({
          success: false,
          error: 'ADMIN_SESSION_EXPIRED',
          message: 'Admin session has expired. Please login again'
        }, { status: 401 })
      };
    }

    // Update admin activity
    admin.lastLogin = new Date();
    await admin.save();

    return {
      success: true,
      admin,
      adminId: decoded.adminId,
      sessionId: decoded.sessionId || 'default',
      authConfig
    };

  } catch (error: any) {
    console.error('Admin auth middleware error:', error);
    return {
      success: false,
      response: NextResponse.json({
        success: false,
        error: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: 'Admin authentication failed'
      }, { status: 500 })
    };
  }
}

// Higher-order function wrapper for admin routes
export function withAdminAuth(
  handler: (request: AdminAuthenticatedRequest) => Promise<NextResponse>,
  options?: AdminAuthOptions
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const authResult = await authWithAdmin(request, options);
    
    if (!authResult.success) {
      return authResult.response;
    }

    // Attach admin data to request
    const authenticatedRequest = request as AdminAuthenticatedRequest;
    authenticatedRequest.admin = authResult.admin;
    authenticatedRequest.adminId = authResult.adminId;
    authenticatedRequest.sessionId = authResult.sessionId;
    authenticatedRequest.authConfig = authResult.authConfig;

    return handler(authenticatedRequest);
  };
}

// Higher-order function wrapper for user routes
export function withAuth(
  handler: (request: AuthenticatedRequest) => Promise<NextResponse>,
  options?: { requireVerified?: boolean }
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const authResult = await authMiddleware(request, options);
    
    if (!authResult.success) {
      return authResult.response;
    }

    // Attach user data to request
    const authenticatedRequest = request as AuthenticatedRequest;
    authenticatedRequest.user = authResult.user;
    authenticatedRequest.userId = authResult.userId;
    authenticatedRequest.deviceId = authResult.deviceId;
    authenticatedRequest.authConfig = authResult.authConfig;

    return handler(authenticatedRequest);
  };
}