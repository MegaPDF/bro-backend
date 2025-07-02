import { EncryptionService } from '@/lib/utils/encryption';
import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import User from '@/lib/db/models/User';
import { analyticsTracker } from '../analytics/tracker';
import { TIME_CONSTANTS } from '@/lib/utils/constants';

export interface UserKeyBundle {
  userId: string;
  deviceId: string;
  identityKey: string;
  privateKey: string;
  publicKey: string;
  keyBundle: {
    identityKey: string;
    signedPreKey: string;
    preKeySignature: string;
    oneTimePreKeys: string[];
    timestamp: Date;
  };
  registrationId: number;
  createdAt: Date;
  lastRotated: Date;
  isActive: boolean;
}

export interface KeyRotationPolicy {
  identityKeyRotationDays: number;
  preKeyRotationDays: number;
  oneTimeKeyRefreshThreshold: number;
  maxOneTimeKeys: number;
}

export interface BackupKeyData {
  encryptedKeys: string;
  backupPassword: string;
  createdAt: Date;
  deviceInfo: {
    platform: string;
    version: string;
  };
}

export class KeyManagementService {
  private static instance: KeyManagementService;
  private keyCache = new Map<string, UserKeyBundle>();
  private readonly CACHE_EXPIRY = 30 * 60 * 1000; // 30 minutes
  
  private readonly defaultRotationPolicy: KeyRotationPolicy = {
    identityKeyRotationDays: 365, // 1 year
    preKeyRotationDays: 30, // 1 month
    oneTimeKeyRefreshThreshold: 10, // Refresh when less than 10 keys
    maxOneTimeKeys: 100
  };

  private constructor() {
    this.startKeyMaintenanceTasks();
  }

  static getInstance(): KeyManagementService {
    if (!KeyManagementService.instance) {
      KeyManagementService.instance = new KeyManagementService();
    }
    return KeyManagementService.instance;
  }

  // Store user encryption keys
  async storeUserKeys(
    userId: string,
    deviceId: string,
    keyBundle: any,
    privateKey?: string
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await connectDB();

      // Generate private key if not provided
      const keyPair = privateKey ? 
        { privateKey, publicKey: keyBundle.identityKey } : 
        EncryptionService.generateE2EKeyPair();

      const userKeyBundle: UserKeyBundle = {
        userId,
        deviceId,
        identityKey: keyBundle.identityKey,
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey,
        keyBundle,
        registrationId: this.generateRegistrationId(),
        createdAt: new Date(),
        lastRotated: new Date(),
        isActive: true
      };

      // Encrypt private key before storage
      const encryptionKey = await this.getOrCreateMasterKey(userId);
      const encryptedPrivateKey = EncryptionService.encrypt(
        keyPair.privateKey,
        encryptionKey
      );

      // Store in database
      const keyId = `${userId}_${deviceId}`;
      await Settings.findOneAndUpdate(
        { category: 'user_keys', key: keyId },
        {
          value: {
            ...userKeyBundle,
            privateKey: `${encryptedPrivateKey.encrypted}:${encryptedPrivateKey.iv}:${encryptedPrivateKey.tag}`
          },
          type: 'object',
          description: `E2E encryption keys for user ${userId} device ${deviceId}`,
          isEncrypted: true,
          isPublic: false,
          updatedBy: userId
        },
        { upsert: true, new: true }
      );

      // Cache the keys (with unencrypted private key)
      this.keyCache.set(keyId, userKeyBundle);

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        userId,
        'key_management',
        'keys_stored',
        { deviceId, hasPrivateKey: !!privateKey }
      );

      return { success: true };

    } catch (error: any) {
      await analyticsTracker.trackError(error, userId, {
        component: 'key_management',
        action: 'store_keys'
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Retrieve user encryption keys
  async getUserKeys(
    userId: string,
    deviceId?: string
  ): Promise<UserKeyBundle | null> {
    try {
      const keyId = deviceId ? `${userId}_${deviceId}` : await this.findPrimaryDevice(userId);
      if (!keyId) return null;

      // Check cache first
      const cached = this.keyCache.get(keyId);
      if (cached) {
        return cached;
      }

      // Retrieve from database
      await connectDB();
      const setting = await Settings.findOne({
        category: 'user_keys',
        key: keyId
      });

      if (!setting?.value) {
        return null;
      }

      const keyBundle = setting.value as UserKeyBundle;

      // Decrypt private key
      const encryptionKey = await this.getOrCreateMasterKey(userId);
      const [encrypted, iv, tag] = keyBundle.privateKey.split(':');
      
      try {
        const decryptedPrivateKey = EncryptionService.decrypt(
          encrypted,
          encryptionKey,
          iv,
          tag
        );
        
        keyBundle.privateKey = decryptedPrivateKey;
      } catch (decryptError) {
        console.error('Error decrypting private key:', decryptError);
        return null;
      }

      // Cache the keys
      this.keyCache.set(keyId, keyBundle);

      return keyBundle;

    } catch (error: any) {
      console.error('Error retrieving user keys:', error);
      return null;
    }
  }

  // Rotate user keys based on policy
  async rotateUserKeys(
    userId: string,
    deviceId: string,
    policy?: Partial<KeyRotationPolicy>
  ): Promise<{
    success: boolean;
    rotated: string[];
    error?: string;
  }> {
    try {
      const currentKeys = await this.getUserKeys(userId, deviceId);
      if (!currentKeys) {
        return {
          success: false,
          rotated: [],
          error: 'User keys not found'
        };
      }

      const rotationPolicy = { ...this.defaultRotationPolicy, ...policy };
      const now = new Date();
      const rotated: string[] = [];

      // Check if identity key needs rotation
      const identityKeyAge = now.getTime() - currentKeys.lastRotated.getTime();
      if (identityKeyAge > rotationPolicy.identityKeyRotationDays * TIME_CONSTANTS.DAY) {
        // Generate new identity key pair
        const newIdentityKeyPair = EncryptionService.generateE2EKeyPair();
        currentKeys.identityKey = newIdentityKeyPair.publicKey;
        currentKeys.privateKey = newIdentityKeyPair.privateKey;
        currentKeys.keyBundle.identityKey = newIdentityKeyPair.publicKey;
        rotated.push('identity_key');
      }

      // Check if signed pre-key needs rotation
      const preKeyAge = now.getTime() - currentKeys.keyBundle.timestamp.getTime();
      if (preKeyAge > rotationPolicy.preKeyRotationDays * TIME_CONSTANTS.DAY) {
        // Generate new signed pre-key
        const newSignedPreKeyPair = EncryptionService.generateE2EKeyPair();
        currentKeys.keyBundle.signedPreKey = newSignedPreKeyPair.publicKey;
        currentKeys.keyBundle.preKeySignature = EncryptionService.generateHMAC(
          newSignedPreKeyPair.publicKey,
          currentKeys.privateKey
        );
        rotated.push('signed_pre_key');
      }

      // Check if one-time keys need refresh
      if (currentKeys.keyBundle.oneTimePreKeys.length < rotationPolicy.oneTimeKeyRefreshThreshold) {
        const newOneTimeKeys: string[] = [];
        const keysToGenerate = rotationPolicy.maxOneTimeKeys - currentKeys.keyBundle.oneTimePreKeys.length;
        
        for (let i = 0; i < keysToGenerate; i++) {
          const oneTimeKeyPair = EncryptionService.generateE2EKeyPair();
          newOneTimeKeys.push(oneTimeKeyPair.publicKey);
        }
        
        currentKeys.keyBundle.oneTimePreKeys.push(...newOneTimeKeys);
        rotated.push('one_time_keys');
      }

      // Update timestamps
      if (rotated.length > 0) {
        currentKeys.lastRotated = now;
        currentKeys.keyBundle.timestamp = now;

        // Store updated keys
        const storeResult = await this.storeUserKeys(
          userId,
          deviceId,
          currentKeys.keyBundle,
          currentKeys.privateKey
        );

        if (!storeResult.success) {
          return {
            success: false,
            rotated: [],
            error: storeResult.error
          };
        }

        // Track analytics
        await analyticsTracker.trackFeatureUsage(
          userId,
          'key_management',
          'keys_rotated',
          { 
            deviceId,
            rotatedKeys: rotated,
            rotationCount: rotated.length
          }
        );
      }

      return {
        success: true,
        rotated
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, userId, {
        component: 'key_management',
        action: 'rotate_keys'
      });

      return {
        success: false,
        rotated: [],
        error: error.message
      };
    }
  }

  // Create backup of user keys
  async createKeyBackup(
    userId: string,
    deviceId: string,
    backupPassword: string,
    deviceInfo: { platform: string; version: string }
  ): Promise<{
    success: boolean;
    backupData?: string;
    error?: string;
  }> {
    try {
      const userKeys = await this.getUserKeys(userId, deviceId);
      if (!userKeys) {
        return {
          success: false,
          error: 'User keys not found'
        };
      }

      // Create backup data
      const backupKeys = {
        identityKey: userKeys.identityKey,
        privateKey: userKeys.privateKey,
        keyBundle: userKeys.keyBundle,
        registrationId: userKeys.registrationId
      };

      // Encrypt backup with password
      const backupKey = EncryptionService.deriveKey(
        backupPassword,
        EncryptionService.generateSalt()
      );
      
      const encryptedBackup = EncryptionService.encrypt(
        JSON.stringify(backupKeys),
        backupKey
      );

      const backupData: BackupKeyData = {
        encryptedKeys: `${encryptedBackup.encrypted}:${encryptedBackup.iv}:${encryptedBackup.tag}`,
        backupPassword: EncryptionService.hash(backupPassword), // Store hash, not actual password
        createdAt: new Date(),
        deviceInfo
      };

      // Store backup
      await Settings.findOneAndUpdate(
        { category: 'key_backups', key: `backup_${userId}_${deviceId}` },
        {
          value: backupData,
          type: 'object',
          description: `Key backup for user ${userId} device ${deviceId}`,
          isEncrypted: true,
          isPublic: false,
          updatedBy: userId
        },
        { upsert: true, new: true }
      );

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        userId,
        'key_management',
        'backup_created',
        { 
          deviceId,
          platform: deviceInfo.platform
        }
      );

      return {
        success: true,
        backupData: Buffer.from(JSON.stringify(backupData)).toString('base64')
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, userId, {
        component: 'key_management',
        action: 'create_backup'
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Restore keys from backup
  async restoreFromBackup(
    userId: string,
    deviceId: string,
    backupData: string,
    backupPassword: string
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // Parse backup data
      const backup = JSON.parse(Buffer.from(backupData, 'base64').toString()) as BackupKeyData;

      // Verify backup password
      const passwordHash = EncryptionService.hash(backupPassword);
      if (passwordHash !== backup.backupPassword) {
        return {
          success: false,
          error: 'Invalid backup password'
        };
      }

      // Decrypt backup
      const backupKey = EncryptionService.deriveKey(
        backupPassword,
        EncryptionService.generateSalt()
      );

      const [encrypted, iv, tag] = backup.encryptedKeys.split(':');
      const decryptedKeys = EncryptionService.decrypt(encrypted, backupKey, iv, tag);
      const restoredKeys = JSON.parse(decryptedKeys);

      // Store restored keys
      const storeResult = await this.storeUserKeys(
        userId,
        deviceId,
        restoredKeys.keyBundle,
        restoredKeys.privateKey
      );

      if (!storeResult.success) {
        return {
          success: false,
          error: storeResult.error
        };
      }

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        userId,
        'key_management',
        'backup_restored',
        { 
          deviceId,
          backupAge: Date.now() - backup.createdAt.getTime()
        }
      );

      return { success: true };

    } catch (error: any) {
      await analyticsTracker.trackError(error, userId, {
        component: 'key_management',
        action: 'restore_backup'
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Delete user keys (when device is removed)
  async deleteUserKeys(userId: string, deviceId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await connectDB();

      const keyId = `${userId}_${deviceId}`;

      // Remove from database
      await Settings.deleteOne({
        category: 'user_keys',
        key: keyId
      });

      // Remove from cache
      this.keyCache.delete(keyId);

      // Remove backups
      await Settings.deleteMany({
        category: 'key_backups',
        key: { $regex: `backup_${userId}_${deviceId}` }
      });

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        userId,
        'key_management',
        'keys_deleted',
        { deviceId }
      );

      return { success: true };

    } catch (error: any) {
      await analyticsTracker.trackError(error, userId, {
        component: 'key_management',
        action: 'delete_keys'
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get or create master encryption key for user
  private async getOrCreateMasterKey(userId: string): Promise<Buffer> {
    try {
      await connectDB();

      let setting = await Settings.findOne({
        category: 'master_keys',
        key: `master_${userId}`
      });

      if (!setting) {
        // Generate new master key
        const masterKey = EncryptionService.generateKey();
        
        await Settings.create({
          category: 'master_keys',
          key: `master_${userId}`,
          value: masterKey.toString('hex'),
          type: 'string',
          description: `Master encryption key for user ${userId}`,
          isEncrypted: true,
          isPublic: false,
          updatedBy: userId
        });

        return masterKey;
      }

      return Buffer.from(setting.value, 'hex');

    } catch (error) {
      console.error('Error getting master key:', error);
      throw error;
    }
  }

  // Find primary device for user
  private async findPrimaryDevice(userId: string): Promise<string | null> {
    try {
      await connectDB();

      const userKeys = await Settings.find({
        category: 'user_keys',
        key: { $regex: `^${userId}_` }
      }).sort({ updatedAt: -1 }).limit(1);

      return userKeys.length > 0 ? userKeys[0].key : null;
    } catch (error) {
      console.error('Error finding primary device:', error);
      return null;
    }
  }

  // Generate unique registration ID
  private generateRegistrationId(): number {
    return Math.floor(Math.random() * 16384) + 1;
  }

  // Start maintenance tasks
  private startKeyMaintenanceTasks(): void {
    // Clean cache every hour
    setInterval(() => {
      this.cleanupCache();
    }, 60 * 60 * 1000);

    // Rotate keys daily
    setInterval(() => {
      this.performScheduledRotation();
    }, 24 * 60 * 60 * 1000);
  }

  // Cleanup expired cache entries
  private cleanupCache(): void {
    // For simplicity, clear entire cache periodically
    // In production, track timestamps and only remove expired entries
    this.keyCache.clear();
  }

  // Perform scheduled key rotation
  private async performScheduledRotation(): Promise<void> {
    try {
      await connectDB();

      const userKeySettings = await Settings.find({
        category: 'user_keys'
      });

      for (const setting of userKeySettings) {
        const keyBundle = setting.value as UserKeyBundle;
        const [userId, deviceId] = setting.key.split('_');

        // Check if rotation is needed
        const lastRotation = new Date(keyBundle.lastRotated);
        const daysSinceRotation = (Date.now() - lastRotation.getTime()) / TIME_CONSTANTS.DAY;

        if (daysSinceRotation > this.defaultRotationPolicy.preKeyRotationDays) {
          await this.rotateUserKeys(userId, deviceId);
        }
      }

      console.log('Scheduled key rotation completed');
    } catch (error) {
      console.error('Error in scheduled key rotation:', error);
    }
  }

  // Get key statistics
  async getKeyStatistics(): Promise<{
    totalUsers: number;
    totalDevices: number;
    keysNeedingRotation: number;
    backupCount: number;
  }> {
    try {
      await connectDB();

      const [userKeys, backups] = await Promise.all([
        Settings.find({ category: 'user_keys' }),
        Settings.find({ category: 'key_backups' })
      ]);

      const users = new Set();
      let keysNeedingRotation = 0;

      userKeys.forEach(setting => {
        const keyBundle = setting.value as UserKeyBundle;
        const [userId] = setting.key.split('_');
        users.add(userId);

        const daysSinceRotation = (Date.now() - new Date(keyBundle.lastRotated).getTime()) / TIME_CONSTANTS.DAY;
        if (daysSinceRotation > this.defaultRotationPolicy.preKeyRotationDays) {
          keysNeedingRotation++;
        }
      });

      return {
        totalUsers: users.size,
        totalDevices: userKeys.length,
        keysNeedingRotation,
        backupCount: backups.length
      };

    } catch (error) {
      console.error('Error getting key statistics:', error);
      return {
        totalUsers: 0,
        totalDevices: 0,
        keysNeedingRotation: 0,
        backupCount: 0
      };
    }
  }
}

// Export singleton instance
export const keyManager = KeyManagementService.getInstance();