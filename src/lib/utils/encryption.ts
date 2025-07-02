import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export class EncryptionService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly KEY_LENGTH = 32; // 256 bits
  private static readonly IV_LENGTH = 16; // 128 bits
  private static readonly TAG_LENGTH = 16; // 128 bits
  private static readonly SALT_LENGTH = 32; // 256 bits

  // Generate a secure random key
  static generateKey(): Buffer {
    return crypto.randomBytes(this.KEY_LENGTH);
  }

  // Generate a secure random IV
  static generateIV(): Buffer {
    return crypto.randomBytes(this.IV_LENGTH);
  }

  // Generate a secure salt
  static generateSalt(): Buffer {
    return crypto.randomBytes(this.SALT_LENGTH);
  }

  // Derive key from password using PBKDF2
  static deriveKey(password: string, salt: Buffer, iterations: number = 100000): Buffer {
    return crypto.pbkdf2Sync(password, salt, iterations, this.KEY_LENGTH, 'sha256');
  }

  // Encrypt data with AES-256-GCM
  static encrypt(data: string, key: Buffer): {
    encrypted: string;
    iv: string;
    tag: string;
  } {
    try {
      const iv = this.generateIV();
      const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const tag = cipher.getAuthTag();

      return {
        encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex')
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error}`);
    }
  }

  // Decrypt data with AES-256-GCM
  static decrypt(encryptedData: string, key: Buffer, iv: string, tag: string): string {
    try {
      const decipher = crypto.createDecipheriv(this.ALGORITHM, key, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(tag, 'hex'));

      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error}`);
    }
  }

  // Hash password with bcrypt
  static async hashPassword(password: string, rounds: number = 12): Promise<string> {
    try {
      return await bcrypt.hash(password, rounds);
    } catch (error) {
      throw new Error(`Password hashing failed: ${error}`);
    }
  }

  // Verify password with bcrypt
  static async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hashedPassword);
    } catch (error) {
      throw new Error(`Password verification failed: ${error}`);
    }
  }

  // Generate HMAC signature
  static generateHMAC(data: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  // Verify HMAC signature
  static verifyHMAC(data: string, signature: string, secret: string): boolean {
    const expectedSignature = this.generateHMAC(data, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  // Generate secure random token
  static generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  // Generate UUID v4
  static generateUUID(): string {
    return crypto.randomUUID();
  }

  // Hash data with SHA-256
  static hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // Generate fingerprint for device/key verification
  static generateFingerprint(publicKey: string, userId: string): string {
    const data = `${publicKey}:${userId}`;
    return this.hash(data).substring(0, 16).toUpperCase();
  }

  // End-to-End Encryption Key Management
  static generateE2EKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    return { publicKey, privateKey };
  }

  // Encrypt with RSA public key
  static encryptWithPublicKey(data: string, publicKey: string): string {
    try {
      const encrypted = crypto.publicEncrypt(
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256'
        },
        Buffer.from(data, 'utf8')
      );
      return encrypted.toString('base64');
    } catch (error) {
      throw new Error(`RSA encryption failed: ${error}`);
    }
  }

  // Decrypt with RSA private key
  static decryptWithPrivateKey(encryptedData: string, privateKey: string): string {
    try {
      const decrypted = crypto.privateDecrypt(
        {
          key: privateKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256'
        },
        Buffer.from(encryptedData, 'base64')
      );
      return decrypted.toString('utf8');
    } catch (error) {
      throw new Error(`RSA decryption failed: ${error}`);
    }
  }

  // Secure data comparison (timing-safe)
  static secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}

// Message Encryption for E2E
export class MessageEncryption {
  static encryptMessage(
    message: string,
    senderPrivateKey: string,
    recipientPublicKey: string
  ): {
    encryptedMessage: string;
    signature: string;
    keyFingerprint: string;
  } {
    // Generate session key
    const sessionKey = EncryptionService.generateKey();
    
    // Encrypt message with session key
    const { encrypted, iv, tag } = EncryptionService.encrypt(message, sessionKey);
    
    // Encrypt session key with recipient's public key
    const encryptedSessionKey = EncryptionService.encryptWithPublicKey(
      sessionKey.toString('hex'),
      recipientPublicKey
    );
    
    // Create signature with sender's private key
    const messageData = `${encrypted}:${iv}:${tag}:${encryptedSessionKey}`;
    const signature = crypto.sign(
      'sha256',
      Buffer.from(messageData),
      {
        key: senderPrivateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
      }
    ).toString('base64');
    
    // Generate key fingerprint
    const keyFingerprint = EncryptionService.generateFingerprint(
      recipientPublicKey,
      'message_encryption'
    );
    
    return {
      encryptedMessage: `${encrypted}:${iv}:${tag}:${encryptedSessionKey}`,
      signature,
      keyFingerprint
    };
  }

  static decryptMessage(
    encryptedMessage: string,
    signature: string,
    senderPublicKey: string,
    recipientPrivateKey: string
  ): string {
    // Verify signature
    const isValidSignature = crypto.verify(
      'sha256',
      Buffer.from(encryptedMessage),
      senderPublicKey,
      Buffer.from(signature, 'base64')
    );
    
    if (!isValidSignature) {
      throw new Error('Invalid message signature');
    }
    
    // Parse encrypted message
    const [encrypted, iv, tag, encryptedSessionKey] = encryptedMessage.split(':');
    
    // Decrypt session key
    const sessionKeyHex = EncryptionService.decryptWithPrivateKey(
      encryptedSessionKey,
      recipientPrivateKey
    );
    const sessionKey = Buffer.from(sessionKeyHex, 'hex');
    
    // Decrypt message
    return EncryptionService.decrypt(encrypted, sessionKey, iv, tag);
  }
}
