import { JWT_CONFIG, OTP_CONFIG, ADMIN_ROLES } from '@/lib/utils/constants';
import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import { Types } from 'mongoose';

export interface AuthConfig {
  jwt: {
    accessTokenSecret: string;
    refreshTokenSecret: string;
    qrTokenSecret: string;
    adminTokenSecret: string;
    accessTokenExpiry: string;
    refreshTokenExpiry: string;
    qrTokenExpiry: string;
    adminTokenExpiry: string;
    issuer: string;
    audience: string;
  };
  otp: {
    length: number;
    expiryMinutes: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
    rateLimitMinutes: number;
  };
  qr: {
    sessionExpiryMinutes: number;
    maxConcurrentSessions: number;
    allowedOrigins: string[];
  };
  security: {
    bcryptRounds: number;
    maxLoginAttempts: number;
    lockoutDurationMinutes: number;
    sessionTimeoutMinutes: number;
    requireTwoFactor: boolean;
    allowedDevicesPerUser: number;
  };
  rateLimiting: {
    login: {
      windowMs: number;
      maxAttempts: number;
    };
    otp: {
      windowMs: number;
      maxAttempts: number;
    };
    qrGenerate: {
      windowMs: number;
      maxAttempts: number;
    };
  };
  admin: {
    roles: typeof ADMIN_ROLES;
    defaultRole: string;
    sessionTimeoutHours: number;
    requireMFA: boolean;
  };
}

export class AuthConfigService {
  private static instance: AuthConfigService;
  private config: AuthConfig | null = null;
  private readonly CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private lastFetched: number = 0;

  private constructor() {}

  static getInstance(): AuthConfigService {
    if (!AuthConfigService.instance) {
      AuthConfigService.instance = new AuthConfigService();
    }
    return AuthConfigService.instance;
  }

  // Get auth configuration
  async getConfig(): Promise<AuthConfig> {
    const now = Date.now();
    
    // Return cached config if still valid
    if (this.config && (now - this.lastFetched) < this.CONFIG_CACHE_TTL) {
      return this.config;
    }

    try {
      await connectDB();
      
      // Fetch configuration from database
      const settings = await Settings.find({
        category: { $in: ['security', 'general'] }
      }).lean();

      // Build configuration object
      this.config = await this.buildConfigFromSettings(settings);
      this.lastFetched = now;

      return this.config;

    } catch (error) {
      console.error('Error fetching auth config:', error);
      
      // Return default configuration as fallback
      if (!this.config) {
        this.config = this.getDefaultConfig();
      }
      
      return this.config;
    }
  }

  // Build configuration from database settings
  private async buildConfigFromSettings(settings: any[]): Promise<AuthConfig> {
    const settingsMap = new Map<string, any>();
    settings.forEach(setting => {
      settingsMap.set(setting.key, setting.value);
    });

    return {
      jwt: {
        accessTokenSecret: this.getSecretOrThrow('JWT_SECRET'),
        refreshTokenSecret: this.getSecretOrThrow('JWT_REFRESH_SECRET'),
        qrTokenSecret: this.getSecretOrThrow('JWT_QR_SECRET', process.env.JWT_SECRET!),
        adminTokenSecret: this.getSecretOrThrow('JWT_ADMIN_SECRET', process.env.JWT_SECRET!),
        accessTokenExpiry: settingsMap.get('jwt_access_token_expiry') || JWT_CONFIG.ACCESS_TOKEN_EXPIRY,
        refreshTokenExpiry: settingsMap.get('jwt_refresh_token_expiry') || JWT_CONFIG.REFRESH_TOKEN_EXPIRY,
        qrTokenExpiry: settingsMap.get('jwt_qr_token_expiry') || JWT_CONFIG.QR_TOKEN_EXPIRY,
        adminTokenExpiry: settingsMap.get('jwt_admin_token_expiry') || JWT_CONFIG.ADMIN_TOKEN_EXPIRY,
        issuer: settingsMap.get('jwt_issuer') || process.env.JWT_ISSUER || 'whatsapp-clone',
        audience: settingsMap.get('jwt_audience') || process.env.JWT_AUDIENCE || 'whatsapp-clone-users'
      },
      otp: {
        length: settingsMap.get('otp_length') || OTP_CONFIG.LENGTH,
        expiryMinutes: settingsMap.get('otp_expiry_minutes') || OTP_CONFIG.EXPIRY_MINUTES,
        maxAttempts: settingsMap.get('otp_max_attempts') || OTP_CONFIG.MAX_ATTEMPTS,
        resendCooldownSeconds: settingsMap.get('otp_resend_cooldown') || OTP_CONFIG.RESEND_COOLDOWN_SECONDS,
        rateLimitMinutes: settingsMap.get('otp_rate_limit_minutes') || OTP_CONFIG.RATE_LIMIT_MINUTES
      },
      qr: {
        sessionExpiryMinutes: settingsMap.get('qr_session_expiry_minutes') || 5,
        maxConcurrentSessions: settingsMap.get('qr_max_concurrent_sessions') || 3,
        allowedOrigins: settingsMap.get('qr_allowed_origins') || ['*']
      },
      security: {
        bcryptRounds: settingsMap.get('bcrypt_rounds') || 12,
        maxLoginAttempts: settingsMap.get('max_login_attempts') || 5,
        lockoutDurationMinutes: settingsMap.get('lockout_duration_minutes') || 15,
        sessionTimeoutMinutes: settingsMap.get('session_timeout_minutes') || 60,
        requireTwoFactor: settingsMap.get('require_two_factor') || false,
        allowedDevicesPerUser: settingsMap.get('allowed_devices_per_user') || 5
      },
      rateLimiting: {
        login: {
          windowMs: settingsMap.get('rate_limit_login_window_ms') || 15 * 60 * 1000, // 15 minutes
          maxAttempts: settingsMap.get('rate_limit_login_max_attempts') || 5
        },
        otp: {
          windowMs: settingsMap.get('rate_limit_otp_window_ms') || 5 * 60 * 1000, // 5 minutes
          maxAttempts: settingsMap.get('rate_limit_otp_max_attempts') || 3
        },
        qrGenerate: {
          windowMs: settingsMap.get('rate_limit_qr_window_ms') || 10 * 60 * 1000, // 10 minutes
          maxAttempts: settingsMap.get('rate_limit_qr_max_attempts') || 10
        }
      },
      admin: {
        roles: ADMIN_ROLES,
        defaultRole: settingsMap.get('admin_default_role') || ADMIN_ROLES.SUPPORT,
        sessionTimeoutHours: settingsMap.get('admin_session_timeout_hours') || 8,
        requireMFA: settingsMap.get('admin_require_mfa') || true
      }
    };
  }

  // Get default configuration
  private getDefaultConfig(): AuthConfig {
    return {
      jwt: {
        accessTokenSecret: this.getSecretOrThrow('JWT_SECRET'),
        refreshTokenSecret: this.getSecretOrThrow('JWT_REFRESH_SECRET'),
        qrTokenSecret: process.env.JWT_QR_SECRET || process.env.JWT_SECRET!,
        adminTokenSecret: process.env.JWT_ADMIN_SECRET || process.env.JWT_SECRET!,
        accessTokenExpiry: JWT_CONFIG.ACCESS_TOKEN_EXPIRY,
        refreshTokenExpiry: JWT_CONFIG.REFRESH_TOKEN_EXPIRY,
        qrTokenExpiry: JWT_CONFIG.QR_TOKEN_EXPIRY,
        adminTokenExpiry: JWT_CONFIG.ADMIN_TOKEN_EXPIRY,
        issuer: process.env.JWT_ISSUER || 'whatsapp-clone',
        audience: process.env.JWT_AUDIENCE || 'whatsapp-clone-users'
      },
      otp: {
        length: OTP_CONFIG.LENGTH,
        expiryMinutes: OTP_CONFIG.EXPIRY_MINUTES,
        maxAttempts: OTP_CONFIG.MAX_ATTEMPTS,
        resendCooldownSeconds: OTP_CONFIG.RESEND_COOLDOWN_SECONDS,
        rateLimitMinutes: OTP_CONFIG.RATE_LIMIT_MINUTES
      },
      qr: {
        sessionExpiryMinutes: 5,
        maxConcurrentSessions: 3,
        allowedOrigins: ['*']
      },
      security: {
        bcryptRounds: 12,
        maxLoginAttempts: 5,
        lockoutDurationMinutes: 15,
        sessionTimeoutMinutes: 60,
        requireTwoFactor: false,
        allowedDevicesPerUser: 5
      },
      rateLimiting: {
        login: {
          windowMs: 15 * 60 * 1000, // 15 minutes
          maxAttempts: 5
        },
        otp: {
          windowMs: 5 * 60 * 1000, // 5 minutes
          maxAttempts: 3
        },
        qrGenerate: {
          windowMs: 10 * 60 * 1000, // 10 minutes
          maxAttempts: 10
        }
      },
      admin: {
        roles: ADMIN_ROLES,
        defaultRole: ADMIN_ROLES.SUPPORT,
        sessionTimeoutHours: 8,
        requireMFA: true
      }
    };
  }

  // Get secret from environment or throw error
  private getSecretOrThrow(envVar: string, fallback?: string): string {
    const secret = process.env[envVar] || fallback;
    if (!secret) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
    return secret;
  }

  // Update configuration
  async updateConfig(updates: Partial<AuthConfig>, updatedBy: string = 'system'): Promise<void> {
    try {
      await connectDB();
      const updatePromises: Promise<any>[] = [];

      // Update JWT settings
      if (updates.jwt) {
        Object.entries(updates.jwt).forEach(([key, value]) => {
          if (key.includes('Secret')) return; // Don't update secrets via this method
          updatePromises.push(
            Settings.findOneAndUpdate(
              { category: 'security', key: `jwt_${key.replace(/([A-Z])/g, '_$1').toLowerCase()}` },
              { 
                value, 
                updatedBy: new Types.ObjectId(updatedBy), 
                updatedAt: new Date() 
              },
              { upsert: true }
            )
          );
        });
      }

      // Update OTP settings
      if (updates.otp) {
        Object.entries(updates.otp).forEach(([key, value]) => {
          updatePromises.push(
            Settings.findOneAndUpdate(
              { category: 'security', key: `otp_${key.replace(/([A-Z])/g, '_$1').toLowerCase()}` },
              { 
                value, 
                updatedBy: new Types.ObjectId(updatedBy), 
                updatedAt: new Date() 
              },
              { upsert: true }
            )
          );
        });
      }

      // Update security settings
      if (updates.security) {
        Object.entries(updates.security).forEach(([key, value]) => {
          updatePromises.push(
            Settings.findOneAndUpdate(
              { category: 'security', key: key.replace(/([A-Z])/g, '_$1').toLowerCase() },
              { 
                value, 
                updatedBy: new Types.ObjectId(updatedBy), 
                updatedAt: new Date() 
              },
              { upsert: true }
            )
          );
        });
      }

      await Promise.all(updatePromises);

      // Clear cache to force reload
      this.config = null;
      this.lastFetched = 0;

    } catch (error) {
      throw new Error(`Failed to update auth configuration: ${error}`);
    }
  }

  // Clear configuration cache
  clearCache(): void {
    this.config = null;
    this.lastFetched = 0;
  }
}