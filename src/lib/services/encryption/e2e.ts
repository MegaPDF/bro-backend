import { EncryptionService, MessageEncryption } from '@/lib/utils/encryption';
import { KeyManagementService } from './keys';
import { connectDB } from '@/lib/db/connection';
import User from '@/lib/db/models/User';
import Settings from '@/lib/db/models/Settings';
import { analyticsTracker } from '../analytics/tracker';

export interface E2ESession {
  sessionId: string;
  participants: string[];
  sessionKey: Buffer;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

export interface EncryptedMessage {
  encryptedContent: string;
  signature: string;
  keyFingerprint: string;
  sessionId: string;
  metadata: {
    algorithm: string;
    version: string;
    timestamp: Date;
  };
}

export interface E2EKeyBundle {
  identityKey: string;
  signedPreKey: string;
  preKeySignature: string;
  oneTimePreKeys: string[];
  timestamp: Date;
}

export interface DeviceBundle {
  deviceId: string;
  registrationId: number;
  keyBundle: E2EKeyBundle;
}

export class E2EEncryptionService {
  private static instance: E2EEncryptionService;
  private keyManager: KeyManagementService;
  private activeSessions = new Map<string, E2ESession>();
  private readonly SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

  private constructor() {
    this.keyManager = KeyManagementService.getInstance();
    this.startSessionCleanup();
  }

  static getInstance(): E2EEncryptionService {
    if (!E2EEncryptionService.instance) {
      E2EEncryptionService.instance = new E2EEncryptionService();
    }
    return E2EEncryptionService.instance;
  }

  // Initialize E2E encryption for a user
  async initializeUserE2E(userId: string, deviceId: string): Promise<{
    success: boolean;
    keyBundle?: E2EKeyBundle;
    error?: string;
  }> {
    try {
      await connectDB();

      // Check if user already has E2E keys
      const existingKeys = await this.keyManager.getUserKeys(userId, deviceId);
      if (existingKeys) {
        return {
          success: true,
          keyBundle: existingKeys.keyBundle
        };
      }

      // Generate new key bundle
      const keyBundle = await this.generateKeyBundle();
      
      // Store keys
      const result = await this.keyManager.storeUserKeys(userId, deviceId, keyBundle);
      if (!result.success) {
        return { success: false, error: result.error };
      }

      // Update user E2E status
      await User.findByIdAndUpdate(userId, {
        'securitySettings.endToEndEncryption': true
      });

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        userId,
        'e2e_encryption',
        'initialize',
        { success: true, deviceId }
      );

      return {
        success: true,
        keyBundle
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, userId, {
        component: 'e2e_encryption',
        action: 'initialize'
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Create encrypted session between users
  async createSession(
    senderUserId: string,
    senderDeviceId: string,
    receiverUserId: string,
    receiverDeviceId: string
  ): Promise<{
    success: boolean;
    sessionId?: string;
    error?: string;
  }> {
    try {
      // Get participant key bundles
      const [senderKeys, receiverKeys] = await Promise.all([
        this.keyManager.getUserKeys(senderUserId, senderDeviceId),
        this.keyManager.getUserKeys(receiverUserId, receiverDeviceId)
      ]);

      if (!senderKeys || !receiverKeys) {
        return {
          success: false,
          error: 'One or both participants do not have E2E encryption enabled'
        };
      }

      // Generate session key using Diffie-Hellman key exchange
      const sessionKey = await this.performKeyExchange(senderKeys, receiverKeys);
      
      // Create session
      const sessionId = this.generateSessionId();
      const session: E2ESession = {
        sessionId,
        participants: [senderUserId, receiverUserId],
        sessionKey,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.SESSION_EXPIRY),
        isActive: true
      };

      // Store session
      this.activeSessions.set(sessionId, session);

      // Store session in database for persistence
      await this.storeSession(session);

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        senderUserId,
        'e2e_encryption',
        'session_created',
        { 
          sessionId,
          participants: 2,
          receiverUserId
        }
      );

      return {
        success: true,
        sessionId
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, senderUserId, {
        component: 'e2e_encryption',
        action: 'create_session'
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Encrypt message for E2E communication
  async encryptMessage(
    senderId: string,
    receiverId: string,
    messageContent: string,
    sessionId?: string
  ): Promise<{
    success: boolean;
    encryptedMessage?: EncryptedMessage;
    error?: string;
  }> {
    try {
      // Get or create session
      let session = sessionId ? this.activeSessions.get(sessionId) : null;
      
      if (!session) {
        // Try to find existing session
        session = await this.findExistingSession(senderId, receiverId);
        
        if (!session) {
          return {
            success: false,
            error: 'No active E2E session found. Please establish a session first.'
          };
        }
      }

      // Encrypt message content
      const { encrypted, iv, tag } = EncryptionService.encrypt(messageContent, session.sessionKey);
      
      // Get sender's private key for signing
      const senderKeys = await this.keyManager.getUserKeys(senderId);
      if (!senderKeys) {
        return {
          success: false,
          error: 'Sender encryption keys not found'
        };
      }

      // Create signature
      const messageData = `${encrypted}:${iv}:${tag}`;
      const signature = EncryptionService.generateHMAC(messageData, senderKeys.privateKey);

      // Generate key fingerprint
      const keyFingerprint = EncryptionService.generateFingerprint(
        senderKeys.keyBundle.identityKey,
        senderId
      );

      const encryptedMessage: EncryptedMessage = {
        encryptedContent: `${encrypted}:${iv}:${tag}`,
        signature,
        keyFingerprint,
        sessionId: session.sessionId,
        metadata: {
          algorithm: 'AES-256-GCM',
          version: '1.0',
          timestamp: new Date()
        }
      };

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        senderId,
        'e2e_encryption',
        'message_encrypted',
        { 
          sessionId: session.sessionId,
          messageLength: messageContent.length
        }
      );

      return {
        success: true,
        encryptedMessage
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, senderId, {
        component: 'e2e_encryption',
        action: 'encrypt_message'
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Decrypt message from E2E communication
  async decryptMessage(
    receiverId: string,
    encryptedMessage: EncryptedMessage
  ): Promise<{
    success: boolean;
    decryptedContent?: string;
    error?: string;
  }> {
    try {
      // Get session
      const session = this.activeSessions.get(encryptedMessage.sessionId);
      if (!session || !session.isActive) {
        return {
          success: false,
          error: 'Session not found or expired'
        };
      }

      // Verify receiver is part of session
      if (!session.participants.includes(receiverId)) {
        return {
          success: false,
          error: 'User not authorized for this session'
        };
      }

      // Parse encrypted content
      const [encrypted, iv, tag] = encryptedMessage.encryptedContent.split(':');
      
      // Verify signature
      const senderId = session.participants.find(id => id !== receiverId);
      if (!senderId) {
        return {
          success: false,
          error: 'Sender not found in session'
        };
      }

      const senderKeys = await this.keyManager.getUserKeys(senderId);
      if (!senderKeys) {
        return {
          success: false,
          error: 'Sender keys not found'
        };
      }

      const messageData = encryptedMessage.encryptedContent;
      const isValidSignature = EncryptionService.verifyHMAC(
        messageData,
        encryptedMessage.signature,
        senderKeys.privateKey
      );

      if (!isValidSignature) {
        return {
          success: false,
          error: 'Message signature verification failed'
        };
      }

      // Decrypt message
      const decryptedContent = EncryptionService.decrypt(
        encrypted,
        session.sessionKey,
        iv,
        tag
      );

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        receiverId,
        'e2e_encryption',
        'message_decrypted',
        { 
          sessionId: session.sessionId,
          senderId
        }
      );

      return {
        success: true,
        decryptedContent
      };

    } catch (error: any) {
      await analyticsTracker.trackError(error, receiverId, {
        component: 'e2e_encryption',
        action: 'decrypt_message'
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Generate new key bundle for device
  async generateKeyBundle(): Promise<E2EKeyBundle> {
    // Generate identity key pair
    const identityKeyPair = EncryptionService.generateE2EKeyPair();
    
    // Generate signed pre-key
    const signedPreKeyPair = EncryptionService.generateE2EKeyPair();
    const preKeySignature = EncryptionService.generateHMAC(
      signedPreKeyPair.publicKey,
      identityKeyPair.privateKey
    );

    // Generate one-time pre-keys
    const oneTimePreKeys: string[] = [];
    for (let i = 0; i < 100; i++) {
      const oneTimeKeyPair = EncryptionService.generateE2EKeyPair();
      oneTimePreKeys.push(oneTimeKeyPair.publicKey);
    }

    return {
      identityKey: identityKeyPair.publicKey,
      signedPreKey: signedPreKeyPair.publicKey,
      preKeySignature,
      oneTimePreKeys,
      timestamp: new Date()
    };
  }

  // Perform Diffie-Hellman key exchange
  private async performKeyExchange(
    senderKeys: any,
    receiverKeys: any
  ): Promise<Buffer> {
    // Simplified key exchange - in production use Signal Protocol
    const sharedSecret = EncryptionService.generateHMAC(
      senderKeys.keyBundle.identityKey + receiverKeys.keyBundle.identityKey,
      'e2e_key_exchange'
    );
    
    return Buffer.from(sharedSecret, 'hex').slice(0, 32); // 256-bit key
  }

  // Find existing session between users
  private async findExistingSession(
    senderId: string,
    receiverId: string
  ): Promise<E2ESession | null> {
    // Check in-memory sessions first
    for (const session of this.activeSessions.values()) {
      if (session.participants.includes(senderId) && 
          session.participants.includes(receiverId) &&
          session.isActive) {
        return session;
      }
    }

    // Check database for persistent sessions
    try {
      await connectDB();
      
      const setting = await Settings.findOne({
        category: 'e2e_sessions',
        key: `session_${[senderId, receiverId].sort().join('_')}`
      });

      if (setting?.value) {
        const session = setting.value as E2ESession;
        if (new Date() < new Date(session.expiresAt)) {
          // Restore to memory
          this.activeSessions.set(session.sessionId, session);
          return session;
        }
      }
    } catch (error) {
      console.error('Error finding existing session:', error);
    }

    return null;
  }

  // Store session in database
  private async storeSession(session: E2ESession): Promise<void> {
    try {
      await connectDB();

      const sessionKey = `session_${session.participants.sort().join('_')}`;
      
      await Settings.findOneAndUpdate(
        { category: 'e2e_sessions', key: sessionKey },
        {
          value: {
            ...session,
            sessionKey: session.sessionKey.toString('hex') // Convert Buffer to string for storage
          },
          type: 'object',
          description: `E2E session between ${session.participants.join(' and ')}`,
          isEncrypted: true,
          isPublic: false,
          updatedBy: 'system'
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error('Error storing session:', error);
    }
  }

  // Generate unique session ID
  private generateSessionId(): string {
    return `e2e_${Date.now()}_${EncryptionService.generateToken(16)}`;
  }

  // Start periodic session cleanup
  private startSessionCleanup(): void {
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 60 * 1000); // Run every hour
  }

  // Clean up expired sessions
  private async cleanupExpiredSessions(): Promise<void> {
    try {
      const now = new Date();
      
      // Clean in-memory sessions
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (now > session.expiresAt) {
          this.activeSessions.delete(sessionId);
        }
      }

      // Clean database sessions
      await connectDB();
      await Settings.deleteMany({
        category: 'e2e_sessions',
        'value.expiresAt': { $lt: now }
      });

      console.log(`Cleaned up expired E2E sessions`);
    } catch (error) {
      console.error('Error cleaning up sessions:', error);
    }
  }

  // Get session info
  getSessionInfo(sessionId: string): E2ESession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  // Get active sessions count
  getActiveSessionsCount(): number {
    return this.activeSessions.size;
  }
}

// Export singleton instance
export const e2eEncryption = E2EEncryptionService.getInstance();