import jwt, { SignOptions, VerifyOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { connectDB } from '@/lib/db/connection';
import User, { IUser } from '@/lib/db/models/User';
import Settings from '@/lib/db/models/Settings';
import { AuthConfigService } from './config';
import { EncryptionService } from '@/lib/utils/encryption';
import { ValidationHelpers } from '@/lib/utils/helpers';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import { ERROR_CODES } from '@/lib/utils/constants';
import type { JWTPayload, AuthUser } from '@/types/auth';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface QRTokenData {
  sessionId: string;
  timestamp: number;
  expiresAt: number;
  deviceInfo?: {
    userAgent: string;
    ip: string;
  };
}

export interface AdminTokenPayload extends JWTPayload {
  adminId: string;
  role: string;
  permissions: string[];
  sessionId: string;
}

export interface RefreshTokenData {
  userId: string;
  deviceId: string;
  tokenId: string;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
  deviceInfo: any;
}

export class JWTService {
  private static instance: JWTService;
  private configService: AuthConfigService;
  private refreshTokens = new Map<string, RefreshTokenData>();

  private constructor() {
    this.configService = AuthConfigService.getInstance();
  }

  static getInstance(): JWTService {
    if (!JWTService.instance) {
      JWTService.instance = new JWTService();
    }
    return JWTService.instance;
  }

  // Generate access token
  async generateAccessToken(
    user: IUser,
    deviceId: string,
    additionalClaims?: Record<string, any>
  ): Promise<string> {
    try {
      const config = await this.configService.getConfig();
      
      // Validate required config values
      if (!config.jwt.accessTokenSecret) {
        throw new Error('Access token secret not configured');
      }
      
      const payload: JWTPayload = {
        userId: user._id.toString(),
        phoneNumber: user.phoneNumber,
        deviceId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + this.parseExpiry(config.jwt.accessTokenExpiry),
        ...additionalClaims
      };

      const signOptions: SignOptions = {
        expiresIn: this.parseExpiry(config.jwt.accessTokenExpiry),
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      };

      const token = jwt.sign(payload, config.jwt.accessTokenSecret, signOptions);

      // Track token generation
      await analyticsTracker.trackUserActivity(
        user._id.toString(),
        'access_token_generated',
        { deviceId }
      );

      return token;

    } catch (error: any) {
      throw new Error(`Failed to generate access token: ${error.message}`);
    }
  }

  // Generate refresh token
  async generateRefreshToken(
    user: IUser,
    deviceId: string,
    deviceInfo: any
  ): Promise<string> {
    try {
      const config = await this.configService.getConfig();
      
      // Validate required config values
      if (!config.jwt.refreshTokenSecret) {
        throw new Error('Refresh token secret not configured');
      }
      
      const tokenId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.parseExpiry(config.jwt.refreshTokenExpiry) * 1000);

      const payload = {
        userId: user._id.toString(),
        deviceId,
        tokenId,
        type: 'refresh'
      };

      const signOptions: SignOptions = {
        expiresIn: this.parseExpiry(config.jwt.refreshTokenExpiry),
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        jwtid: tokenId
      };

      const token = jwt.sign(payload, config.jwt.refreshTokenSecret, signOptions);

      // Store refresh token data
      const refreshTokenData: RefreshTokenData = {
        userId: user._id.toString(),
        deviceId,
        tokenId,
        createdAt: now,
        expiresAt,
        isActive: true,
        deviceInfo
      };

      // Store in memory cache
      this.refreshTokens.set(tokenId, refreshTokenData);

      // Store in database for persistence
      await this.storeRefreshTokenInDB(tokenId, refreshTokenData);

      return token;

    } catch (error: any) {
      throw new Error(`Failed to generate refresh token: ${error.message}`);
    }
  }

  // Generate token pair (access + refresh)
  async generateTokenPair(
    user: IUser,
    deviceId: string,
    deviceInfo: any
  ): Promise<TokenPair> {
    try {
      const config = await this.configService.getConfig();
      
      const [accessToken, refreshToken] = await Promise.all([
        this.generateAccessToken(user, deviceId),
        this.generateRefreshToken(user, deviceId, deviceInfo)
      ]);

      const expiresIn = this.parseExpiry(config.jwt.accessTokenExpiry);

      return {
        accessToken,
        refreshToken,
        expiresIn,
        tokenType: 'Bearer'
      };

    } catch (error: any) {
      throw new Error(`Failed to generate token pair: ${error.message}`);
    }
  }

  // Generate QR authentication token
  async generateQRToken(sessionId: string, deviceInfo?: any): Promise<string> {
    try {
      const config = await this.configService.getConfig();
      
      // Validate required config values
      if (!config.jwt.qrTokenSecret) {
        throw new Error('QR token secret not configured');
      }
      
      const timestamp = Date.now();
      const expiresAt = timestamp + (config.qr.sessionExpiryMinutes * 60 * 1000);

      const payload: QRTokenData = {
        sessionId,
        timestamp,
        expiresAt,
        deviceInfo
      };

      const signOptions: SignOptions = {
        expiresIn: this.parseExpiry(config.jwt.qrTokenExpiry),
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      };

      const token = jwt.sign(payload, config.jwt.qrTokenSecret, signOptions);

      return token;

    } catch (error: any) {
      throw new Error(`Failed to generate QR token: ${error.message}`);
    }
  }

  // Generate admin token
  async generateAdminToken(
    adminUser: any,
    sessionId: string
  ): Promise<string> {
    try {
      const config = await this.configService.getConfig();
      
      // Validate required config values
      if (!config.jwt.adminTokenSecret) {
        throw new Error('Admin token secret not configured');
      }
      
      const payload: AdminTokenPayload = {
        userId: adminUser._id.toString(),
        phoneNumber: adminUser.phoneNumber || '',
        deviceId: 'admin-panel',
        adminId: adminUser._id.toString(),
        role: adminUser.role,
        permissions: this.flattenPermissions(adminUser.permissions || {}),
        sessionId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + this.parseExpiry(config.jwt.adminTokenExpiry)
      };

      const signOptions: SignOptions = {
        expiresIn: this.parseExpiry(config.jwt.adminTokenExpiry),
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      };

      const token = jwt.sign(payload, config.jwt.adminTokenSecret, signOptions);

      return token;

    } catch (error: any) {
      throw new Error(`Failed to generate admin token: ${error.message}`);
    }
  }

  // Verify access token
  async verifyAccessToken(token: string): Promise<JWTPayload> {
    try {
      if (!ValidationHelpers.isValidJWTFormat(token)) {
        throw new Error('Invalid token format');
      }

      const config = await this.configService.getConfig();
      
      // Validate required config values
      if (!config.jwt.accessTokenSecret) {
        throw new Error('Access token secret not configured');
      }
      
      const verifyOptions: VerifyOptions = {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      };

      const decoded = jwt.verify(token, config.jwt.accessTokenSecret, verifyOptions) as JWTPayload;

      // Verify user still exists and is active
      await connectDB();
      const user = await User.findById(decoded.userId).lean() as (IUser & { status?: string }) | null;
      
      if (!user || user.status !== 'active') {
        throw new Error('User not found or inactive');
      }

      return decoded;

    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token expired');
      }
      if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token');
      }
      throw error;
    }
  }

  // Verify refresh token
  async verifyRefreshToken(token: string): Promise<RefreshTokenData> {
    try {
      if (!ValidationHelpers.isValidJWTFormat(token)) {
        throw new Error('Invalid token format');
      }

      const config = await this.configService.getConfig();
      
      // Validate required config values
      if (!config.jwt.refreshTokenSecret) {
        throw new Error('Refresh token secret not configured');
      }
      
      const verifyOptions: VerifyOptions = {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      };

      const decoded = jwt.verify(token, config.jwt.refreshTokenSecret, verifyOptions) as any;

      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Get refresh token data
      let refreshTokenData = this.refreshTokens.get(decoded.tokenId);
      
      if (!refreshTokenData) {
        // Try to load from database
        const dbTokenData = await this.getRefreshTokenFromDB(decoded.tokenId);
        refreshTokenData = dbTokenData === null ? undefined : dbTokenData;
        if (refreshTokenData) {
          this.refreshTokens.set(decoded.tokenId, refreshTokenData);
        }
      }

      if (!refreshTokenData || !refreshTokenData.isActive) {
        throw new Error('Refresh token not found or inactive');
      }

      if (new Date() > refreshTokenData.expiresAt) {
        throw new Error('Refresh token expired');
      }

      return refreshTokenData;

    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Refresh token expired');
      }
      if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid refresh token');
      }
      throw error;
    }
  }

  // Verify QR token
  async verifyQRToken(token: string): Promise<QRTokenData> {
    try {
      const config = await this.configService.getConfig();
      
      const verifyOptions: VerifyOptions = {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      };

      const decoded = jwt.verify(token, config.jwt.qrTokenSecret, verifyOptions) as QRTokenData;

      // Check if token is expired
      if (Date.now() > decoded.expiresAt) {
        throw new Error('QR token expired');
      }

      return decoded;

    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('QR token expired');
      }
      if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid QR token');
      }
      throw error;
    }
  }

  // Verify admin token
  async verifyAdminToken(token: string): Promise<AdminTokenPayload> {
    try {
      const config = await this.configService.getConfig();
      
      const verifyOptions: VerifyOptions = {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      };

      const decoded = jwt.verify(token, config.jwt.adminTokenSecret, verifyOptions) as AdminTokenPayload;

      // Verify admin user still exists and has permissions
      await connectDB();
      const adminUser = await User.findById(decoded.adminId).lean() as (IUser & { status?: string }) | null;
      
      if (!adminUser || adminUser.status !== 'active') {
        throw new Error('Admin user not found or inactive');
      }

      return decoded;

    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Admin token expired');
      }
      if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid admin token');
      }
      throw error;
    }
  }

  // Refresh access token using refresh token
  async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
    try {
      const refreshTokenData = await this.verifyRefreshToken(refreshToken);
      
      // Get user data
      await connectDB();
      const user = await User.findById(refreshTokenData.userId).lean() as (IUser & { status?: string }) | null;
      
      if (!user || user.status !== 'active') {
        throw new Error('User not found or inactive');
      }

      // Generate new access token
      const accessToken = await this.generateAccessToken(user as IUser, refreshTokenData.deviceId);
      
      // Get expiry time
      const config = await this.configService.getConfig();
      const expiresIn = this.parseExpiry(config.jwt.accessTokenExpiry);

      return {
        accessToken,
        refreshToken, // Keep the same refresh token
        expiresIn,
        tokenType: 'Bearer'
      };

    } catch (error: any) {
      throw new Error(`Failed to refresh token: ${error.message}`);
    }
  }

  // Revoke refresh token
  async revokeRefreshToken(tokenId: string): Promise<void> {
    try {
      // Remove from memory cache
      this.refreshTokens.delete(tokenId);

      // Mark as inactive in database
      await this.updateRefreshTokenInDB(tokenId, { isActive: false });

    } catch (error: any) {
      throw new Error(`Failed to revoke refresh token: ${error.message}`);
    }
  }

  // Revoke all user tokens
  async revokeAllUserTokens(userId: string, deviceId?: string): Promise<void> {
    try {
      // Filter tokens to revoke
      const tokensToRevoke: string[] = [];
      
      for (const [tokenId, tokenData] of this.refreshTokens.entries()) {
        if (tokenData.userId === userId && (!deviceId || tokenData.deviceId === deviceId)) {
          tokensToRevoke.push(tokenId);
        }
      }

      // Revoke tokens
      await Promise.all(tokensToRevoke.map(tokenId => this.revokeRefreshToken(tokenId)));

      // Also revoke in database
      await this.revokeAllUserTokensInDB(userId, deviceId);

    } catch (error: any) {
      throw new Error(`Failed to revoke user tokens: ${error.message}`);
    }
  }

  // Parse expiry string to seconds
  private parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) throw new Error('Invalid expiry format');

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 60 * 60 * 24;
      default: throw new Error('Invalid expiry unit');
    }
  }

  // Flatten admin permissions for JWT payload
  private flattenPermissions(permissions: any): string[] {
    const flatPermissions: string[] = [];
    
    for (const [category, perms] of Object.entries(permissions)) {
      const categoryPerms = perms as any;
      if (categoryPerms.read) flatPermissions.push(`${category}:read`);
      if (categoryPerms.write) flatPermissions.push(`${category}:write`);
      if (categoryPerms.delete) flatPermissions.push(`${category}:delete`);
    }
    
    return flatPermissions;
  }

  // Store refresh token in database
  private async storeRefreshTokenInDB(tokenId: string, tokenData: RefreshTokenData): Promise<void> {
    try {
      await connectDB();

      await Settings.create({
        category: 'security',
        key: `refresh_token_${tokenId}`,
        value: {
          ...tokenData,
          // Encrypt sensitive data
          deviceInfo: EncryptionService.encrypt(
            JSON.stringify(tokenData.deviceInfo),
            Buffer.from(process.env.ENCRYPTION_KEY || 'fallback-key')
          )
        },
        type: 'object',
        description: `Refresh token for user ${tokenData.userId}`,
        isEncrypted: true,
        isPublic: false,
        updatedBy: tokenData.userId
      });

    } catch (error) {
      console.error('Error storing refresh token in DB:', error);
    }
  }

  // Get refresh token from database
  private async getRefreshTokenFromDB(tokenId: string): Promise<RefreshTokenData | null> {
    try {
      await connectDB();

      const setting = await Settings.findOne({
        category: 'security',
        key: `refresh_token_${tokenId}`
      }).lean();

      if (!setting || Array.isArray(setting)) return null;

      const tokenData = (setting as any).value as RefreshTokenData;
      
      // Decrypt device info if encrypted
      if (
        typeof tokenData.deviceInfo === 'object' &&
        tokenData.deviceInfo !== null &&
        'encrypted' in tokenData.deviceInfo &&
        'iv' in tokenData.deviceInfo &&
        'tag' in tokenData.deviceInfo
      ) {
        const deviceInfoEnc = tokenData.deviceInfo as {
          encrypted: string;
          iv: string;
          tag: string;
        };
        tokenData.deviceInfo = JSON.parse(
          EncryptionService.decrypt(
            deviceInfoEnc.encrypted,
            Buffer.from(process.env.ENCRYPTION_KEY || 'fallback-key'),
            deviceInfoEnc.iv,
            deviceInfoEnc.tag
          )
        );
      }

      return tokenData;

    } catch (error) {
      console.error('Error getting refresh token from DB:', error);
      return null;
    }
  }

  // Update refresh token in database
  private async updateRefreshTokenInDB(tokenId: string, updates: Partial<RefreshTokenData>): Promise<void> {
    try {
      await connectDB();

      await Settings.findOneAndUpdate(
        {
          category: 'security',
          key: `refresh_token_${tokenId}`
        },
        {
          $set: {
            'value.isActive': updates.isActive,
            updatedAt: new Date()
          }
        }
      );

    } catch (error) {
      console.error('Error updating refresh token in DB:', error);
    }
  }

  // Revoke all user tokens in database
  private async revokeAllUserTokensInDB(userId: string, deviceId?: string): Promise<void> {
    try {
      await connectDB();

      const query: any = {
        category: 'security',
        key: { $regex: '^refresh_token_' },
        'value.userId': userId
      };

      if (deviceId) {
        query['value.deviceId'] = deviceId;
      }

      await Settings.updateMany(query, {
        $set: {
          'value.isActive': false,
          updatedAt: new Date()
        }
      });

    } catch (error) {
      console.error('Error revoking user tokens in DB:', error);
    }
  }
}