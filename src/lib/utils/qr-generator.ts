import QRCode from 'qrcode';
import crypto from 'crypto';
import { JWT_CONFIG } from './constants';
import jwt from 'jsonwebtoken';

export interface QRAuthData {
  sessionId: string;
  timestamp: number;
  expiresAt: number;
  deviceInfo?: {
    userAgent: string;
    ip: string;
  };
}

export interface QRLoginSession {
  sessionId: string;
  token: string;
  qrCode: string;
  expiresAt: Date;
  isUsed: boolean;
  userId?: string;
  deviceInfo?: any;
}

export class QRCodeService {
  private static readonly QR_CODE_SIZE = 256;
  private static readonly QR_CODE_MARGIN = 4;
  private static readonly SESSION_EXPIRY_MINUTES = 5;

  // Generate QR code for authentication
  static async generateAuthQR(
    deviceInfo?: { userAgent: string; ip: string }
  ): Promise<{
    sessionId: string;
    token: string;
    qrCodeUrl: string;
    expiresAt: Date;
  }> {
    try {
      // Generate unique session ID
      const sessionId = crypto.randomUUID();
      const timestamp = Date.now();
      const expiresAt = new Date(timestamp + (this.SESSION_EXPIRY_MINUTES * 60 * 1000));

      // Create QR auth data
      const qrData: QRAuthData = {
        sessionId,
        timestamp,
        expiresAt: expiresAt.getTime(),
        deviceInfo
      };

      // Create JWT token for QR code
      const token = jwt.sign(qrData, process.env.JWT_SECRET!, {
        expiresIn: JWT_CONFIG.QR_TOKEN_EXPIRY
      });

      // Generate QR code
      const qrCodeUrl = await QRCode.toDataURL(token, {
        width: this.QR_CODE_SIZE,
        margin: this.QR_CODE_MARGIN,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });

      return {
        sessionId,
        token,
        qrCodeUrl,
        expiresAt
      };

    } catch (error: any) {
      throw new Error(`QR generation failed: ${error.message}`);
    }
  }

  // Generate QR code for group invite
  static async generateGroupInviteQR(
    groupId: string,
    inviteCode: string,
    groupName: string
  ): Promise<string> {
    try {
      const inviteData = {
        type: 'group_invite',
        groupId,
        inviteCode,
        groupName,
        timestamp: Date.now()
      };

      const qrCodeUrl = await QRCode.toDataURL(JSON.stringify(inviteData), {
        width: this.QR_CODE_SIZE,
        margin: this.QR_CODE_MARGIN,
        color: {
          dark: '#25D366', // WhatsApp green
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });

      return qrCodeUrl;

    } catch (error: any) {
      throw new Error(`Group invite QR generation failed: ${error.message}`);
    }
  }

  // Generate QR code for contact sharing
  static async generateContactQR(
    userId: string,
    displayName: string,
    phoneNumber: string,
    avatar?: string
  ): Promise<string> {
    try {
      const contactData = {
        type: 'contact_share',
        userId,
        displayName,
        phoneNumber,
        avatar,
        timestamp: Date.now()
      };

      const qrCodeUrl = await QRCode.toDataURL(JSON.stringify(contactData), {
        width: this.QR_CODE_SIZE,
        margin: this.QR_CODE_MARGIN,
        color: {
          dark: '#128C7E', // WhatsApp dark green
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });

      return qrCodeUrl;

    } catch (error: any) {
      throw new Error(`Contact QR generation failed: ${error.message}`);
    }
  }

  // Generate QR code for WiFi sharing
  static async generateWiFiQR(
    ssid: string,
    password: string,
    security: 'WPA' | 'WEP' | 'nopass' = 'WPA'
  ): Promise<string> {
    try {
      const wifiString = `WIFI:T:${security};S:${ssid};P:${password};;`;

      const qrCodeUrl = await QRCode.toDataURL(wifiString, {
        width: this.QR_CODE_SIZE,
        margin: this.QR_CODE_MARGIN,
        color: {
          dark: '#007BB5', // Blue for WiFi
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });

      return qrCodeUrl;

    } catch (error: any) {
      throw new Error(`WiFi QR generation failed: ${error.message}`);
    }
  }

  // Verify QR token
  static verifyQRToken(token: string): QRAuthData {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as QRAuthData;
      
      // Check if token is expired
      if (Date.now() > decoded.expiresAt) {
        throw new Error('QR code has expired');
      }

      return decoded;

    } catch (error: any) {
      if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid QR token');
      }
      if (error.name === 'TokenExpiredError') {
        throw new Error('QR code has expired');
      }
      throw error;
    }
  }

  // Parse QR code data
  static parseQRData(qrString: string): any {
    try {
      // Try to parse as JSON first
      return JSON.parse(qrString);
    } catch {
      // If not JSON, check for specific formats
      if (qrString.startsWith('WIFI:')) {
        return this.parseWiFiQR(qrString);
      }
      
      // Try to verify as JWT token
      try {
        return this.verifyQRToken(qrString);
      } catch {
        throw new Error('Invalid QR code format');
      }
    }
  }

  // Parse WiFi QR code
  private static parseWiFiQR(wifiString: string): {
    type: string;
    ssid: string;
    password: string;
    security: string;
  } {
    const regex = /WIFI:T:([^;]*);S:([^;]*);P:([^;]*);/;
    const match = wifiString.match(regex);

    if (!match) {
      throw new Error('Invalid WiFi QR format');
    }

    return {
      type: 'wifi',
      security: match[1],
      ssid: match[2],
      password: match[3]
    };
  }

  // Generate QR code with custom styling
  static async generateCustomQR(
    data: string,
    options: {
      width?: number;
      margin?: number;
      darkColor?: string;
      lightColor?: string;
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    } = {}
  ): Promise<string> {
    try {
      const qrCodeUrl = await QRCode.toDataURL(data, {
        width: options.width || this.QR_CODE_SIZE,
        margin: options.margin || this.QR_CODE_MARGIN,
        color: {
          dark: options.darkColor || '#000000',
          light: options.lightColor || '#FFFFFF'
        },
        errorCorrectionLevel: options.errorCorrectionLevel || 'M'
      });

      return qrCodeUrl;

    } catch (error: any) {
      throw new Error(`Custom QR generation failed: ${error.message}`);
    }
  }
}