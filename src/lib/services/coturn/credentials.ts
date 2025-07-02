import crypto from 'crypto';
import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import { TIME_CONSTANTS } from '@/lib/utils/constants';
import { EncryptionService } from '@/lib/utils/encryption';

export interface TurnCredentials {
  username: string;
  credential: string;
  ttl: number;
  expiresAt: Date;
}

export interface TurnServerConfig {
  urls: string[];
  username: string;
  credential: string;
  credentialType: 'password';
}

export interface CoturnCredentialOptions {
  ttl?: number; // Time to live in seconds
  userId?: string;
  region?: string;
  sharedSecret?: string;
}

export class CoturnCredentialsService {
  private static readonly DEFAULT_TTL = 12 * 60 * 60; // 12 hours
  private static readonly MIN_TTL = 60; // 1 minute
  private static readonly MAX_TTL = 24 * 60 * 60; // 24 hours

  // Generate TURN credentials using time-based algorithm
  static async generateCredentials(options: CoturnCredentialOptions = {}): Promise<TurnCredentials> {
    try {
      const ttl = this.validateTTL(options.ttl || this.DEFAULT_TTL);
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = new Date((now + ttl) * 1000);

      // Get shared secret from settings or use provided one
      const sharedSecret = options.sharedSecret || await this.getSharedSecret(options.region);
      
      // Create time-based username (timestamp + optional userId)
      const timestamp = now + ttl;
      const userPart = options.userId ? `${options.userId}:` : '';
      const username = `${timestamp}:${userPart}turn`;

      // Generate credential using HMAC-SHA1
      const credential = this.generateTurnCredential(username, sharedSecret);

      return {
        username,
        credential,
        ttl,
        expiresAt
      };

    } catch (error: any) {
      throw new Error(`Failed to generate TURN credentials: ${error.message}`);
    }
  }

  // Generate static long-term credentials
  static async generateStaticCredentials(
    username: string, 
    password: string,
    options: CoturnCredentialOptions = {}
  ): Promise<TurnCredentials> {
    try {
      const ttl = this.validateTTL(options.ttl || this.DEFAULT_TTL);
      const expiresAt = new Date(Date.now() + ttl * 1000);

      // For static credentials, we can use the password directly or hash it
      const credential = await EncryptionService.hashPassword(password);

      return {
        username,
        credential,
        ttl,
        expiresAt
      };

    } catch (error: any) {
      throw new Error(`Failed to generate static TURN credentials: ${error.message}`);
    }
  }

  // Validate TURN credentials
  static async validateCredentials(
    username: string, 
    credential: string,
    region?: string
  ): Promise<{ isValid: boolean; expiresAt?: Date; error?: string }> {
    try {
      // Parse username to extract timestamp
      const parts = username.split(':');
      if (parts.length < 2) {
        return { isValid: false, error: 'Invalid username format' };
      }

      const timestamp = parseInt(parts[0]);
      if (isNaN(timestamp)) {
        return { isValid: false, error: 'Invalid timestamp in username' };
      }

      // Check if credentials are expired
      const now = Math.floor(Date.now() / 1000);
      if (timestamp <= now) {
        return { isValid: false, error: 'Credentials have expired' };
      }

      // Get shared secret and validate credential
      const sharedSecret = await this.getSharedSecret(region);
      const expectedCredential = this.generateTurnCredential(username, sharedSecret);

      if (credential !== expectedCredential) {
        return { isValid: false, error: 'Invalid credential' };
      }

      return {
        isValid: true,
        expiresAt: new Date(timestamp * 1000)
      };

    } catch (error: any) {
      return { isValid: false, error: error.message };
    }
  }

  // Generate REST API credentials for admin access
  static async generateAdminCredentials(adminId: string): Promise<{
    apiKey: string;
    apiSecret: string;
    expiresAt: Date;
  }> {
    try {
      const apiKey = `admin_${adminId}_${EncryptionService.generateToken(16)}`;
      const apiSecret = EncryptionService.generateToken(32);
      const expiresAt = new Date(Date.now() + 7 * TIME_CONSTANTS.DAY); // 7 days

      // Store in settings for validation
      await this.storeAdminCredentials(apiKey, apiSecret, adminId, expiresAt);

      return { apiKey, apiSecret, expiresAt };

    } catch (error: any) {
      throw new Error(`Failed to generate admin credentials: ${error.message}`);
    }
  }

  // Rotate shared secret
  static async rotateSharedSecret(region?: string): Promise<{ oldSecret: string; newSecret: string }> {
    try {
      await connectDB();

      const settingKey = region ? `coturn_shared_secret_${region}` : 'coturn_shared_secret_default';
      const oldSecretSetting = await Settings.findOne({ 
        category: 'coturn', 
        key: settingKey 
      });

      const oldSecret = oldSecretSetting?.value || '';
      const newSecret = EncryptionService.generateToken(32);

      // Update or create setting
      await Settings.findOneAndUpdate(
        { category: 'coturn', key: settingKey },
        {
          value: newSecret,
          description: `COTURN shared secret${region ? ` for ${region}` : ''}`,
          type: 'string',
          isEncrypted: true,
          updatedBy: 'system'
        },
        { upsert: true, new: true }
      );

      return { oldSecret, newSecret };

    } catch (error: any) {
      throw new Error(`Failed to rotate shared secret: ${error.message}`);
    }
  }

  // Clean up expired credentials
  static async cleanupExpiredCredentials(): Promise<{ cleaned: number }> {
    try {
      await connectDB();

      const result = await Settings.deleteMany({
        category: 'coturn',
        key: { $regex: /^admin_credentials_/ },
        'value.expiresAt': { $lt: new Date() }
      });

      return { cleaned: result.deletedCount || 0 };

    } catch (error: any) {
      console.error('Error cleaning up expired credentials:', error);
      return { cleaned: 0 };
    }
  }

  // Private helper methods
  private static generateTurnCredential(username: string, sharedSecret: string): string {
    return EncryptionService.generateHMAC(username, sharedSecret);
  }

  private static async getSharedSecret(region?: string): Promise<string> {
    try {
      await connectDB();

      const settingKey = region ? `coturn_shared_secret_${region}` : 'coturn_shared_secret_default';
      const setting = await Settings.findOne({ 
        category: 'coturn', 
        key: settingKey 
      });

      if (!setting?.value) {
        // Generate and store new shared secret
        const newSecret = EncryptionService.generateToken(32);
        await Settings.create({
          category: 'coturn',
          key: settingKey,
          value: newSecret,
          type: 'string',
          description: `COTURN shared secret${region ? ` for ${region}` : ''}`,
          isEncrypted: true,
          isPublic: false,
          updatedBy: 'system'
        });
        return newSecret;
      }

      return setting.value;

    } catch (error: any) {
      throw new Error(`Failed to get shared secret: ${error.message}`);
    }
  }

  private static validateTTL(ttl: number): number {
    if (ttl < this.MIN_TTL) return this.MIN_TTL;
    if (ttl > this.MAX_TTL) return this.MAX_TTL;
    return ttl;
  }

  private static async storeAdminCredentials(
    apiKey: string, 
    apiSecret: string, 
    adminId: string, 
    expiresAt: Date
  ): Promise<void> {
    try {
      await connectDB();

      const hashedSecret = await EncryptionService.hashPassword(apiSecret);

      await Settings.create({
        category: 'coturn',
        key: `admin_credentials_${apiKey}`,
        value: {
          apiSecret: hashedSecret,
          adminId,
          expiresAt
        },
        type: 'object',
        description: `Admin API credentials for ${adminId}`,
        isEncrypted: true,
        isPublic: false,
        updatedBy: adminId
      });

    } catch (error: any) {
      throw new Error(`Failed to store admin credentials: ${error.message}`);
    }
  }
}