import { NextRequest, NextResponse } from 'next/server';
import { Socket } from 'socket.io';
import { JWTService } from './jwt';
import { AuthConfigService } from './config';
import { connectDB } from '@/lib/db/connection';
import User, { IUser } from '@/lib/db/models/User';
import Admin, { IAdmin } from '@/lib/db/models/Admin';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import { ValidationHelpers } from '@/lib/utils/helpers';
import { ERROR_CODES } from '@/lib/utils/constants';
import type {  AdminTokenPayload } from './jwt';
import type { AuthUser } from '@/types/auth';
import type { APIResponse, JWTPayload } from '@/types/api';

export interface AuthenticatedRequest extends NextRequest {
  user: IUser;
  tokenPayload: JWTPayload;
  deviceId: string;
}

export interface AdminAuthenticatedRequest extends NextRequest {
  admin: IAdmin;
  tokenPayload: AdminTokenPayload;
  sessionId: string;
}

export interface AuthenticatedSocket extends Socket {
  userId: string;
  deviceId: string;
  user: IUser;
}

export interface AuthMiddlewareOptions {
  required?: boolean;
  allowExpired?: boolean;
  checkUserStatus?: boolean;
  requireVerification?: boolean;
  allowedRoles?: string[];
  rateLimitKey?: string;
}

export interface AdminAuthOptions {
  requiredPermissions?: string[];
  requiredRole?: string;
  requireMFA?: boolean;
}

export class AuthMiddleware {
  private static instance: AuthMiddleware;
  private jwtService: JWTService;
  private configService: AuthConfigService;
  private rateLimiters = new Map<string, any>();

  private constructor() {
    this.jwtService = JWTService.getInstance();
    this.configService = AuthConfigService.getInstance();
    this.setupRateLimiters();
  }

  static getInstance(): AuthMiddleware {
    if (!AuthMiddleware.instance) {
      AuthMiddleware.instance = new AuthMiddleware();
    }
    return AuthMiddleware.instance;
  }

  // Setup rate limiters
  private async setupRateLimiters(): Promise<void> {
    try {
      const config = await this.configService.getConfig();

      // Simple in-memory rate limiting
      this.rateLimiters.set('login', {
        windowMs: config.rateLimiting.login.windowMs,
        max: config.rateLimiting.login.maxAttempts,
        attempts: new Map<string, { count: number; resetTime: number }>()
      });

      this.rateLimiters.set('otp', {
        windowMs: config.rateLimiting.otp.windowMs,
        max: config.rateLimiting.otp.maxAttempts,
        attempts: new Map<string, { count: number; resetTime: number }>()
      });

      this.rateLimiters.set('qr_generate', {
        windowMs: config.rateLimiting.qrGenerate.windowMs,
        max: config.rateLimiting.qrGenerate.maxAttempts,
        attempts: new Map<string, { count: number; resetTime: number }>()
      });

    } catch (error) {
      console.error('Error setting up rate limiters:', error);
    }
  }

  // Main authentication middleware for API routes
  async authenticateAPIRoute(
    request: NextRequest,
    options: AuthMiddlewareOptions = {}
  ): Promise<{
    success: boolean;
    user?: IUser;
    tokenPayload?: JWTPayload;
    error?: string;
    response?: NextResponse;
  }> {
    try {
      const {
        required = true,
        allowExpired = false,
        checkUserStatus = true,
        requireVerification = false
      } = options;

      // Extract token from Authorization header
      const authHeader = request.headers.get('Authorization');
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        if (!required) {
          return { success: true };
        }
        return {
          success: false,
          error: 'Missing or invalid authorization header',
          response: NextResponse.json(
            this.createErrorResponse('Unauthorized', ERROR_CODES.UNAUTHORIZED),
            { status: 401 }
          )
        };
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Verify token
      let tokenPayload: JWTPayload;
      try {
        tokenPayload = await this.jwtService.verifyAccessToken(token);
      } catch (error: any) {
        if (!allowExpired || !error.message.includes('expired')) {
          return {
            success: false,
            error: error.message,
            response: NextResponse.json(
              this.createErrorResponse(
                error.message.includes('expired') ? 'Token expired' : 'Invalid token',
                error.message.includes('expired') ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.INVALID_TOKEN
              ),
              { status: 401 }
            )
          };
        }
        // For expired tokens, still decode to get payload (for refresh scenarios)
        tokenPayload = this.decodeTokenUnsafe(token);
      }

      // Get user data
      await connectDB();
      const user = await User.findById(tokenPayload.userId).lean() as unknown as IUser;

      if (!user) {
        return {
          success: false,
          error: 'User not found',
          response: NextResponse.json(
            this.createErrorResponse('User not found', ERROR_CODES.USER_NOT_FOUND),
            { status: 404 }
          )
        };
      }

      // Check user status
      if (checkUserStatus && user.status !== 'active') {
        const errorCode = user.status === 'blocked' ? ERROR_CODES.USER_BLOCKED : 
                         user.status === 'suspended' ? ERROR_CODES.USER_SUSPENDED : 
                         ERROR_CODES.UNAUTHORIZED;
        
        return {
          success: false,
          error: 'User account inactive',
          response: NextResponse.json(
            this.createErrorResponse('Account inactive', errorCode),
            { status: 403 }
          )
        };
      }

      // Check verification requirement
      if (requireVerification && !user.isVerified) {
        return {
          success: false,
          error: 'Email verification required',
          response: NextResponse.json(
            this.createErrorResponse('Email verification required', ERROR_CODES.UNAUTHORIZED),
            { status: 403 }
          )
        };
      }

      // Track authentication
      await analyticsTracker.trackUserActivity(
        user._id.toString(),
        'api_authenticated',
        {
          endpoint: request.url,
          deviceId: tokenPayload.deviceId,
          userAgent: request.headers.get('User-Agent')
        }
      );

      return {
        success: true,
        user: user,
        tokenPayload
      };

    } catch (error: any) {
      console.error('Authentication middleware error:', error);
      return {
        success: false,
        error: 'Authentication failed',
        response: NextResponse.json(
          this.createErrorResponse('Internal authentication error', ERROR_CODES.INTERNAL_SERVER_ERROR),
          { status: 500 }
        )
      };
    }
  }

  // Admin authentication middleware
  async authenticateAdmin(
    request: NextRequest,
    options: AdminAuthOptions = {}
  ): Promise<{
    success: boolean;
    admin?: IAdmin;
    tokenPayload?: AdminTokenPayload;
    error?: string;
    response?: NextResponse;
  }> {
    try {
      const {
        requiredPermissions = [],
        requiredRole,
        requireMFA = false
      } = options;

      // Extract token
      const authHeader = request.headers.get('Authorization');
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
          success: false,
          error: 'Missing admin authorization',
          response: NextResponse.json(
            this.createErrorResponse('Admin authorization required', ERROR_CODES.UNAUTHORIZED),
            { status: 401 }
          )
        };
      }

      const token = authHeader.substring(7);

      // Verify admin token
      const tokenPayload = await this.jwtService.verifyAdminToken(token);

      // Get admin user data
      await connectDB();
      const admin = await Admin.findById(tokenPayload.adminId).lean() as IAdmin | null;

      if (!admin || !admin.isActive) {
        return {
          success: false,
          error: 'Admin user not found or inactive',
          response: NextResponse.json(
            this.createErrorResponse('Invalid admin credentials', ERROR_CODES.UNAUTHORIZED),
            { status: 403 }
          )
        };
      }

      // Check role requirement
      if (requiredRole && tokenPayload.role !== requiredRole) {
        return {
          success: false,
          error: 'Insufficient admin role',
          response: NextResponse.json(
            this.createErrorResponse('Insufficient permissions', ERROR_CODES.FORBIDDEN),
            { status: 403 }
          )
        };
      }

      // Check permissions
      if (requiredPermissions.length > 0) {
        const hasPermissions = requiredPermissions.every(permission =>
          tokenPayload.permissions.includes(permission)
        );

        if (!hasPermissions) {
          return {
            success: false,
            error: 'Missing required permissions',
            response: NextResponse.json(
              this.createErrorResponse('Insufficient permissions', ERROR_CODES.FORBIDDEN),
              { status: 403 }
            )
          };
        }
      }

      // Track admin access
      await analyticsTracker.trackUserActivity(
        tokenPayload.adminId,
        'admin_authenticated',
        {
          endpoint: request.url,
          role: tokenPayload.role,
          sessionId: tokenPayload.sessionId
        }
      );

      return {
        success: true,
        admin: admin as unknown as IAdmin,
        tokenPayload
      };

    } catch (error: any) {
      console.error('Admin authentication error:', error);
      return {
        success: false,
        error: error.message,
        response: NextResponse.json(
          this.createErrorResponse('Admin authentication failed', ERROR_CODES.UNAUTHORIZED),
          { status: 401 }
        )
      };
    }
  }

  // Socket.IO authentication middleware
  async authenticateSocket(
    socket: Socket,
    next: (err?: Error) => void
  ): Promise<void> {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      // Verify JWT token
      const tokenPayload = await this.jwtService.verifyAccessToken(token);
      
      // Get user data
      await connectDB();
      const user = await User.findById(tokenPayload.userId).lean() as IUser | null;
      
      if (!user || user.status !== 'active') {
        return next(new Error('Invalid user or user not active'));
      }

      // Attach data to socket
      const authenticatedSocket = socket as AuthenticatedSocket;
      authenticatedSocket.userId = tokenPayload.userId;
      authenticatedSocket.deviceId = tokenPayload.deviceId;
      authenticatedSocket.user = user as unknown as IUser;

      // Set socket data
      socket.data = {
        userId: tokenPayload.userId,
        deviceId: tokenPayload.deviceId,
        isAuthenticated: true,
        joinedRooms: []
      };

      // Track socket authentication
      await analyticsTracker.trackUserActivity(
        tokenPayload.userId,
        'socket_authenticated',
        {
          socketId: socket.id,
          deviceId: tokenPayload.deviceId
        }
      );

      next();

    } catch (error: any) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  }

  // Apply rate limiting to request
  async applyRateLimit(
    request: NextRequest,
    type: string,
    identifier?: string
  ): Promise<{
    allowed: boolean;
    response?: NextResponse;
  }> {
    try {
      const rateLimiter = this.rateLimiters.get(type);
      
      if (!rateLimiter) {
        return { allowed: true };
      }

      const key = identifier || this.getClientIdentifier(request);
      const now = Date.now();
      
      const clientData = rateLimiter.attempts.get(key);
      
      if (!clientData || now > clientData.resetTime) {
        // Reset window
        rateLimiter.attempts.set(key, {
          count: 1,
          resetTime: now + rateLimiter.windowMs
        });
        return { allowed: true };
      }

      if (clientData.count >= rateLimiter.max) {
        return {
          allowed: false,
          response: NextResponse.json(
            this.createErrorResponse('Rate limit exceeded', ERROR_CODES.RATE_LIMIT_EXCEEDED),
            { 
              status: 429,
              headers: {
                'Retry-After': Math.ceil((clientData.resetTime - now) / 1000).toString()
              }
            }
          )
        };
      }

      // Increment count
      clientData.count++;
      return { allowed: true };

    } catch (error) {
      console.error('Rate limiting error:', error);
      return { allowed: true }; // Fail open
    }
  }

  // Create authenticated request wrapper
  withAuth(
    handler: (request: AuthenticatedRequest) => Promise<NextResponse>,
    options: AuthMiddlewareOptions = {}
  ) {
    return async (request: NextRequest): Promise<NextResponse> => {
      // Apply rate limiting if specified
      if (options.rateLimitKey) {
        const rateLimitResult = await this.applyRateLimit(request, options.rateLimitKey);
        if (!rateLimitResult.allowed) {
          return rateLimitResult.response!;
        }
      }

      // Authenticate request
      const authResult = await this.authenticateAPIRoute(request, options);
      
      if (!authResult.success) {
        return authResult.response!;
      }

      // Create authenticated request
      const authenticatedRequest = request as AuthenticatedRequest;
      authenticatedRequest.user = authResult.user!;
      authenticatedRequest.tokenPayload = authResult.tokenPayload!;
      authenticatedRequest.deviceId = authResult.tokenPayload!.deviceId;

      // Call the handler
      return await handler(authenticatedRequest);
    };
  }

  // Create admin authenticated request wrapper
  withAdminAuth(
    handler: (request: AdminAuthenticatedRequest) => Promise<NextResponse>,
    options: AdminAuthOptions = {}
  ) {
    return async (request: NextRequest): Promise<NextResponse> => {
      // Authenticate admin request
      const authResult = await this.authenticateAdmin(request, options);
      
      if (!authResult.success) {
        return authResult.response!;
      }

      // Create authenticated request
      const authenticatedRequest = request as AdminAuthenticatedRequest;
      authenticatedRequest.admin = authResult.admin!;
      authenticatedRequest.tokenPayload = authResult.tokenPayload!;
      authenticatedRequest.sessionId = authResult.tokenPayload!.sessionId;

      // Call the handler
      return await handler(authenticatedRequest);
    };
  }

  // Optional authentication wrapper
  withOptionalAuth(
    handler: (request: NextRequest, user?: IUser, tokenPayload?: JWTPayload) => Promise<NextResponse>
  ) {
    return async (request: NextRequest): Promise<NextResponse> => {
      // Try to authenticate but don't fail if authentication fails
      const authResult = await this.authenticateAPIRoute(request, { required: false });
      
      // Call handler with optional user data
      return await handler(request, authResult.user, authResult.tokenPayload);
    };
  }

  // Utility methods
  private createErrorResponse(message: string, code: string): APIResponse {
    return {
      success: false,
      error: message,
      code,
      timestamp: new Date()
    };
  }

  private decodeTokenUnsafe(token: string): JWTPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload as JWTPayload;
  }

  private getClientIdentifier(request: NextRequest): string {
    // Try to get IP from various headers
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    
    const ip = forwarded?.split(',')[0] || realIp || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    
    return `${ip}:${Buffer.from(userAgent).toString('base64').substring(0, 10)}`;
  }
}

// Export convenience functions
export const authMiddleware = AuthMiddleware.getInstance();

export const withAuth = (
  handler: (request: AuthenticatedRequest) => Promise<NextResponse>,
  options?: AuthMiddlewareOptions
) => authMiddleware.withAuth(handler, options);

export const withAdminAuth = (
  handler: (request: AdminAuthenticatedRequest) => Promise<NextResponse>,
  options?: AdminAuthOptions
) => authMiddleware.withAdminAuth(handler, options);

export const withOptionalAuth = (
  handler: (request: NextRequest, user?: IUser, tokenPayload?: JWTPayload) => Promise<NextResponse>
) => authMiddleware.withOptionalAuth(handler);

export const authenticateSocket = (
  socket: Socket,
  next: (err?: Error) => void
) => authMiddleware.authenticateSocket(socket, next);