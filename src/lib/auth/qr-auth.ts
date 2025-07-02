import crypto from 'crypto';
import QRCode from 'qrcode';
import { Server } from 'socket.io';
import { JWTService } from './jwt';
import { AuthConfigService } from './config';
import { connectDB } from '@/lib/db/connection';
import User, { IUser } from '@/lib/db/models/User';
import Settings from '@/lib/db/models/Settings';
import { EncryptionService } from '@/lib/utils/encryption';
import { ValidationHelpers } from '@/lib/utils/helpers';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import { SOCKET_EVENTS, ERROR_CODES } from '@/lib/utils/constants';
import type { AuthUser, QRCodeResponse } from '@/types/auth';

export interface QRLoginSession {
  sessionId: string;
  token: string;
  qrCodeUrl: string;
  expiresAt: Date;
  isUsed: boolean;
  isScanned: boolean;
  userId?: string;
  deviceInfo?: {
    userAgent: string;
    ip: string;
    platform: string;
  };
  clientSocketId?: string;
  mobileSocketId?: string;
  createdAt: Date;
  lastActivity: Date;
}

export interface QRScanResult {
  success: boolean;
  sessionId: string;
  userId?: string;
  requiresConfirmation?: boolean;
  error?: string;
}

export interface QRLoginConfirmation {
  sessionId: string;
  userId: string;
  deviceInfo: any;
  approved: boolean;
}

export interface QRLoginResult {
  success: boolean;
  user?: AuthUser;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
}

export class QRAuthService {
  private static instance: QRAuthService;
  private jwtService: JWTService;
  private configService: AuthConfigService;
  private activeSessions = new Map<string, QRLoginSession>();
  private userSessions = new Map<string, Set<string>>(); // userId -> Set of sessionIds
  private socketService?: Server;

  private readonly QR_CODE_SIZE = 256;
  private readonly QR_CODE_MARGIN = 4;
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    this.jwtService = JWTService.getInstance();
    this.configService = AuthConfigService.getInstance();
    this.startCleanupTask();
  }

  static getInstance(): QRAuthService {
    if (!QRAuthService.instance) {
      QRAuthService.instance = new QRAuthService();
    }
    return QRAuthService.instance;
  }

  // Set Socket.IO server for real-time communication
  setSocketService(socketService: Server): void {
    this.socketService = socketService;
  }

  // Generate QR code for login
  async generateQRCode(
    deviceInfo?: { userAgent: string; ip: string; platform?: string },
    clientSocketId?: string
  ): Promise<QRCodeResponse> {
    try {
      const config = await this.configService.getConfig();

      // Check concurrent sessions limit
      if (this.activeSessions.size >= config.qr.maxConcurrentSessions * 100) {
        throw new Error('Too many active QR sessions');
      }

      // Generate session ID and JWT token
      const sessionId = crypto.randomUUID();
      const timestamp = Date.now();
      const expiresAt = new Date(timestamp + (config.qr.sessionExpiryMinutes * 60 * 1000));

      // Generate QR token
      const token = await this.jwtService.generateQRToken(sessionId, deviceInfo);

      // Generate QR code image
      const qrCodeUrl = await this.generateQRCodeImage(token);

      // Create session
      const session: QRLoginSession = {
        sessionId,
        token,
        qrCodeUrl,
        expiresAt,
        isUsed: false,
        isScanned: false,
        deviceInfo: deviceInfo ? { ...deviceInfo, platform: deviceInfo.platform ?? 'unknown' } : undefined,
        clientSocketId,
        createdAt: new Date(),
        lastActivity: new Date()
      };

      // Store session
      this.activeSessions.set(sessionId, session);
      await this.storeSessionInDB(session);

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        'system',
        'qr_auth',
        'qr_generated',
        {
          sessionId,
          platform: deviceInfo?.platform || 'unknown',
          ip: deviceInfo?.ip
        }
      );

      console.log(`QR code generated for session: ${sessionId}`);

      return {
        qrToken: token,
        qrCodeUrl,
        expiresIn: config.qr.sessionExpiryMinutes * 60
      };

    } catch (error: any) {
      console.error('Error generating QR code:', error);
      throw new Error(`Failed to generate QR code: ${error.message}`);
    }
  }

  // Scan QR code (mobile app)
  async scanQRCode(
    qrToken: string,
    userId: string,
    mobileSocketId?: string
  ): Promise<QRScanResult> {
    try {
      // Verify and decode QR token
      const tokenData = await this.jwtService.verifyQRToken(qrToken);
      const sessionId = tokenData.sessionId;

      // Get session
      let session = this.activeSessions.get(sessionId);
      if (!session) {
        // Try to load from database
        const dbSession = await this.getSessionFromDB(sessionId);
        if (dbSession) {
          this.activeSessions.set(sessionId, dbSession);
          session = dbSession;
        } else {
          return {
            success: false,
            sessionId,
            error: 'QR session not found or expired'
          };
        }
      }

      // Check session validity
      if (session.isUsed) {
        return {
          success: false,
          sessionId,
          error: 'QR code already used'
        };
      }

      if (new Date() > session.expiresAt) {
        this.cleanupSession(sessionId);
        return {
          success: false,
          sessionId,
          error: 'QR code expired'
        };
      }

      // Verify user exists and is active
      await connectDB();
      const user = await User.findById(userId).lean();

      // Ensure user is a single object and not an array/null
      if (!user || Array.isArray(user) || user.status !== 'active') {
        return {
          success: false,
          sessionId,
          error: 'Invalid user or user not active'
        };
      }

      // Update session
      session.isScanned = true;
      session.userId = userId;
      session.mobileSocketId = mobileSocketId;
      session.lastActivity = new Date();

      // Update session in storage
      this.activeSessions.set(sessionId, session);
      await this.updateSessionInDB(sessionId, {
        isScanned: true,
        userId,
        mobileSocketId,
        lastActivity: new Date()
      });

      // Add to user sessions
      if (!this.userSessions.has(userId)) {
        this.userSessions.set(userId, new Set());
      }
      this.userSessions.get(userId)!.add(sessionId);

      // Notify web client that QR was scanned
      if (this.socketService && session.clientSocketId) {
        this.socketService.to(session.clientSocketId).emit(SOCKET_EVENTS.AUTH_LOGIN, {
          type: 'qr_scanned',
          sessionId,
          user: {
            displayName: (user as any).displayName,
            avatar: (user as any).avatar
          }
        });
      }

      // Track analytics
      await analyticsTracker.trackUserActivity(
        userId,
        'qr_scanned',
        {
          sessionId,
          deviceInfo: session.deviceInfo
        }
      );

      console.log(`QR code scanned by user ${userId} for session: ${sessionId}`);

      return {
        success: true,
        sessionId,
        userId,
        requiresConfirmation: true
      };

    } catch (error: any) {
      console.error('Error scanning QR code:', error);
      return {
        success: false,
        sessionId: '',
        error: error.message
      };
    }
  }

  // Confirm QR login (mobile app)
  async confirmQRLogin(confirmation: QRLoginConfirmation): Promise<void> {
    try {
      const { sessionId, userId, deviceInfo, approved } = confirmation;

      // Get session
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      // Verify session ownership
      if (session.userId !== userId) {
        throw new Error('Session ownership mismatch');
      }

      if (!approved) {
        // User rejected the login
        await this.rejectQRLogin(sessionId, userId);
        return;
      }

      // Get user data
      await connectDB();
      const userDoc = await User.findById(userId).lean();
      const user = userDoc as unknown as IUser;
      
      if (!user || user.status !== 'active') {
        throw new Error('User not found or inactive');
      }

      // Generate tokens for the web client
      const tokenPair = await this.jwtService.generateTokenPair(
        user,
        deviceInfo.deviceId,
        deviceInfo
      );

      // Mark session as used
      session.isUsed = true;
      session.lastActivity = new Date();
      this.activeSessions.set(sessionId, session);
      await this.updateSessionInDB(sessionId, {
        isUsed: true,
        lastActivity: new Date()
      });

      // Notify web client of successful login
      if (this.socketService && session.clientSocketId) {
        this.socketService.to(session.clientSocketId).emit(SOCKET_EVENTS.AUTH_LOGIN, {
          type: 'qr_login_success',
          sessionId,
          user: user as AuthUser,
          accessToken: tokenPair.accessToken,
          refreshToken: tokenPair.refreshToken,
          expiresIn: tokenPair.expiresIn
        });
      }

      // Notify mobile app of success
      if (this.socketService && session.mobileSocketId) {
        this.socketService.to(session.mobileSocketId).emit(SOCKET_EVENTS.AUTH_LOGIN, {
          type: 'qr_login_confirmed',
          sessionId,
          success: true
        });
      }

      // Track analytics
      await analyticsTracker.trackUserActivity(
        userId,
        'qr_login_confirmed',
        {
          sessionId,
          deviceInfo: session.deviceInfo,
          loginDeviceInfo: deviceInfo
        }
      );

      console.log(`QR login confirmed for user ${userId}, session: ${sessionId}`);

      // Cleanup session after short delay
      setTimeout(() => this.cleanupSession(sessionId), 5000);

    } catch (error: any) {
      console.error('Error confirming QR login:', error);
      throw error;
    }
  }

  // Reject QR login (mobile app)
  async rejectQRLogin(sessionId: string, userId: string): Promise<void> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      // Verify session ownership
      if (session.userId !== userId) {
        throw new Error('Session ownership mismatch');
      }

      // Notify web client of rejection
      if (this.socketService && session.clientSocketId) {
        this.socketService.to(session.clientSocketId).emit(SOCKET_EVENTS.AUTH_LOGIN, {
          type: 'qr_login_rejected',
          sessionId,
          error: 'Login rejected by user'
        });
      }

      // Notify mobile app
      if (this.socketService && session.mobileSocketId) {
        this.socketService.to(session.mobileSocketId).emit(SOCKET_EVENTS.AUTH_LOGIN, {
          type: 'qr_login_rejected',
          sessionId,
          success: false
        });
      }

      // Track analytics
      await analyticsTracker.trackUserActivity(
        userId,
        'qr_login_rejected',
        { sessionId }
      );

      console.log(`QR login rejected for session: ${sessionId}`);

      // Cleanup session
      this.cleanupSession(sessionId);

    } catch (error: any) {
      console.error('Error rejecting QR login:', error);
      throw error;
    }
  }

  // Check QR session status (web client polling)
  async getQRSessionStatus(sessionId: string): Promise<{
    status: 'pending' | 'scanned' | 'confirmed' | 'rejected' | 'expired';
    isScanned: boolean;
    isUsed: boolean;
    user?: { displayName: string; avatar?: string };
    error?: string;
  }> {
    try {
      let session = this.activeSessions.get(sessionId);
      
      if (!session) {
        // Try to load from database
        const dbSession = await this.getSessionFromDB(sessionId);
        if (!dbSession) {
          return {
            status: 'expired',
            isScanned: false,
            isUsed: false,
            error: 'Session not found'
          };
        }
        this.activeSessions.set(sessionId, dbSession);
        session = dbSession;
      }

      // Check expiry
      if (new Date() > session.expiresAt) {
        this.cleanupSession(sessionId);
        return {
          status: 'expired',
          isScanned: session.isScanned,
          isUsed: session.isUsed,
          error: 'Session expired'
        };
      }

      // Update last activity
      session.lastActivity = new Date();

      let status: 'pending' | 'scanned' | 'confirmed' | 'rejected' | 'expired' = 'pending';
      let user: { displayName: string; avatar?: string } | undefined;

      if (session.isUsed) {
        status = 'confirmed';
      } else if (session.isScanned) {
        status = 'scanned';
        
        // Get user info if available
        if (session.userId) {
          await connectDB();
          const userDoc = await User.findById(session.userId).select('displayName avatar').lean();
          if (userDoc && !Array.isArray(userDoc)) {
            user = {
              displayName: (userDoc as any).displayName,
              avatar: (userDoc as any).avatar
            };
          }
        }
      }

      return {
        status,
        isScanned: session.isScanned,
        isUsed: session.isUsed,
        user
      };

    } catch (error: any) {
      console.error('Error checking QR session status:', error);
      return {
        status: 'expired',
        isScanned: false,
        isUsed: false,
        error: 'Failed to check session status'
      };
    }
  }

  // Cancel QR session (web client)
  async cancelQRSession(sessionId: string): Promise<void> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (session) {
        // Notify mobile app if connected
        if (this.socketService && session.mobileSocketId) {
          this.socketService.to(session.mobileSocketId).emit(SOCKET_EVENTS.AUTH_LOGIN, {
            type: 'qr_session_cancelled',
            sessionId
          });
        }
      }

      this.cleanupSession(sessionId);
    } catch (error) {
      console.error('Error cancelling QR session:', error);
    }
  }

  // Generate QR code image
  private async generateQRCodeImage(token: string): Promise<string> {
    try {
      const qrCodeUrl = await QRCode.toDataURL(token, {
        width: this.QR_CODE_SIZE,
        margin: this.QR_CODE_MARGIN,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });

      return qrCodeUrl;
    } catch (error: any) {
      throw new Error(`QR code generation failed: ${error.message}`);
    }
  }

  // Store session in database
  private async storeSessionInDB(session: QRLoginSession): Promise<void> {
    try {
      await connectDB();

      await Settings.create({
        category: 'security',
        key: `qr_session_${session.sessionId}`,
        value: {
          ...session,
          deviceInfo: session.deviceInfo ? EncryptionService.encrypt(
            JSON.stringify(session.deviceInfo),
            Buffer.from(process.env.ENCRYPTION_KEY || 'fallback-key')
          ) : undefined
        },
        type: 'object',
        description: `QR login session ${session.sessionId}`,
        isEncrypted: true,
        isPublic: false,
        updatedBy: 'system'
      });

    } catch (error) {
      console.error('Error storing QR session in DB:', error);
    }
  }

  // Get session from database
  private async getSessionFromDB(sessionId: string): Promise<QRLoginSession | null> {
    try {
      await connectDB();

      const setting = await Settings.findOne({
        category: 'security',
        key: `qr_session_${sessionId}`
      }).lean();

      if (!setting || Array.isArray(setting)) return null;

      const sessionData = (setting as any).value as QRLoginSession;
      
      // Decrypt device info if encrypted
      if (
        sessionData.deviceInfo &&
        typeof sessionData.deviceInfo === 'object' &&
        'encrypted' in sessionData.deviceInfo &&
        'iv' in sessionData.deviceInfo &&
        'tag' in sessionData.deviceInfo
      ) {
        const deviceInfoEnc = sessionData.deviceInfo as any;
        sessionData.deviceInfo = JSON.parse(
          EncryptionService.decrypt(
            deviceInfoEnc.encrypted,
            Buffer.from(process.env.ENCRYPTION_KEY || 'fallback-key'),
            deviceInfoEnc.iv,
            deviceInfoEnc.tag
          )
        );
      }

      return sessionData;

    } catch (error) {
      console.error('Error getting QR session from DB:', error);
      return null;
    }
  }

  // Update session in database
  private async updateSessionInDB(sessionId: string, updates: Partial<QRLoginSession>): Promise<void> {
    try {
      await connectDB();

      const updateData: any = {};
      Object.entries(updates).forEach(([key, value]) => {
        updateData[`value.${key}`] = value;
      });

      await Settings.findOneAndUpdate(
        {
          category: 'security',
          key: `qr_session_${sessionId}`
        },
        {
          $set: {
            ...updateData,
            updatedAt: new Date()
          }
        }
      );

    } catch (error) {
      console.error('Error updating QR session in DB:', error);
    }
  }

  // Cleanup session
  private cleanupSession(sessionId: string): void {
    try {
      const session = this.activeSessions.get(sessionId);
      if (session && session.userId) {
        const userSessions = this.userSessions.get(session.userId);
        if (userSessions) {
          userSessions.delete(sessionId);
          if (userSessions.size === 0) {
            this.userSessions.delete(session.userId);
          }
        }
      }

      this.activeSessions.delete(sessionId);

      // Remove from database
      this.removeSessionFromDB(sessionId);

    } catch (error) {
      console.error('Error cleaning up QR session:', error);
    }
  }

  // Remove session from database
  private async removeSessionFromDB(sessionId: string): Promise<void> {
    try {
      await connectDB();

      await Settings.findOneAndDelete({
        category: 'security',
        key: `qr_session_${sessionId}`
      });

    } catch (error) {
      console.error('Error removing QR session from DB:', error);
    }
  }

  // Start cleanup task for expired sessions
  private startCleanupTask(): void {
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.CLEANUP_INTERVAL);
  }

  // Cleanup expired sessions
  private async cleanupExpiredSessions(): Promise<void> {
    try {
      const now = new Date();
      const expiredSessions: string[] = [];

      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (now > session.expiresAt) {
          expiredSessions.push(sessionId);
        }
      }

      // Cleanup expired sessions
      expiredSessions.forEach(sessionId => {
        this.cleanupSession(sessionId);
      });

      // Also cleanup from database
      await connectDB();
      await Settings.deleteMany({
        category: 'security',
        key: { $regex: '^qr_session_' },
        'value.expiresAt': { $lt: now }
      });

      if (expiredSessions.length > 0) {
        console.log(`Cleaned up ${expiredSessions.length} expired QR sessions`);
      }

    } catch (error) {
      console.error('Error cleaning up expired QR sessions:', error);
    }
  }
}