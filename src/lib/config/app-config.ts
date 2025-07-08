import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';

// Configuration interfaces
export interface AppConfig {
  general: GeneralConfig;
  features: FeaturesConfig;
  security: SecurityConfig;
  aws: AWSConfig;
  email: EmailConfig;
  coturn: COTURNConfig;
  pushNotifications: PushNotificationConfig;
}

export interface GeneralConfig {
  appName: string;
  appVersion: string;
  companyName: string;
  supportEmail: string;
  maxFileSize: number;
  maintenanceMode: boolean;
}

export interface FeaturesConfig {
  groupMaxMembers: number;
  disappearingMessages: boolean;
  statusMaxDurationSeconds: number;
  voiceCallEnabled: boolean;
  videoCallEnabled: boolean;
  maxCallParticipants: number;
  broadcastEnabled: boolean;
  messageReactionsEnabled: boolean;
}

export interface SecurityConfig {
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
    resendCooldown: number;
    rateLimitMinutes: number;
  };
  qr: {
    sessionExpiryMinutes: number;
    maxConcurrentSessions: number;
    allowedOrigins: string[];
  };
  bcryptRounds: number;
  maxLoginAttempts: number;
  lockoutDurationMinutes: number;
  sessionTimeoutMinutes: number;
  requireTwoFactor: boolean;
  allowedDevicesPerUser: number;
  rateLimit: {
    loginWindowMs: number;
    loginMaxAttempts: number;
    otpWindowMs: number;
    otpMaxAttempts: number;
    qrWindowMs: number;
    qrMaxAttempts: number;
  };
  admin: {
    defaultRole: string;
    sessionTimeoutHours: number;
    requireMfa: boolean;
  };
}

export interface AWSConfig {
  region: string;
  s3Bucket: string;
  s3BucketPublic: string;
  cloudfrontDomain: string;
  sesSenderEmail: string;
  sesSenderName: string;
  snsTopicArn: string;
  lambdaFunctionPrefix: string;
}

export interface EmailConfig {
  provider: 'ses' | 'smtp' | 'sendgrid';
  fromEmail: string;
  fromName: string;
  replyToEmail: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
  };
  templates: {
    welcomeEnabled: boolean;
    otpEnabled: boolean;
    passwordResetEnabled: boolean;
  };
}

export interface COTURNConfig {
  enabled: boolean;
  stunServers: string[];
  turnServers: Array<{
    urls: string;
    username: string;
    credential: string;
  }>;
  turnUsername: string;
  turnPassword: string;
  turnTtlSeconds: number;
  iceServersRefreshInterval: number;
  fallbackToPublicStun: boolean;
  videoBitrateMax: number;
  audioBitrateMax: number;
  callTimeoutSeconds: number;
}

export interface PushNotificationConfig {
  enabled: boolean;
  provider: 'fcm' | 'apns' | 'both';
  fcm: {
    serverKey: string;
    senderId: string;
    projectId: string;
  };
  apns: {
    enabled: boolean;
    teamId: string;
    keyId: string;
    bundleId: string;
    production: boolean;
  };
  webPush: {
    enabled: boolean;
    vapidPublicKey: string;
    vapidPrivateKey: string;
    vapidSubject: string;
  };
  behavior: {
    defaultSound: string;
    badgeEnabled: boolean;
    groupNotifications: boolean;
    callNotifications: boolean;
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
  };
}

export class AppConfigService {
  private static instance: AppConfigService;
  private config: AppConfig | null = null;
  private lastFetched: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  static getInstance(): AppConfigService {
    if (!AppConfigService.instance) {
      AppConfigService.instance = new AppConfigService();
    }
    return AppConfigService.instance;
  }

  // Get complete application configuration
  async getConfig(): Promise<AppConfig> {
    const now = Date.now();
    
    // Return cached config if still valid
    if (this.config && (now - this.lastFetched) < this.CACHE_TTL) {
      return this.config;
    }

    try {
      await connectDB();
      
      // Fetch all settings from database
      const settings = await Settings.find({}).lean();
      
      // Build configuration from settings
      this.config = await this.buildConfigFromSettings(settings);
      this.lastFetched = now;

      return this.config;

    } catch (error) {
      console.error('Error fetching app config:', error);
      
      // Return default configuration as fallback
      if (!this.config) {
        this.config = this.getDefaultConfig();
      }
      
      return this.config;
    }
  }

  // Get configuration for specific category
  async getCategoryConfig<T extends keyof AppConfig>(category: T): Promise<AppConfig[T]> {
    const config = await this.getConfig();
    return config[category];
  }

  // Update configuration
  async updateConfig(
    category: keyof AppConfig,
    updates: Record<string, any>,
    updatedBy: string = 'system'
  ): Promise<void> {
    try {
      await connectDB();
      const updatePromises: Promise<any>[] = [];

      Object.entries(updates).forEach(([key, value]) => {
        const settingKey = this.convertToSettingKey(key);
        updatePromises.push(
          Settings.findOneAndUpdate(
            { category, key: settingKey },
            { 
              value, 
              updatedBy, 
              updatedAt: new Date() 
            },
            { upsert: true }
          )
        );
      });

      await Promise.all(updatePromises);

      // Clear cache to force reload
      this.clearCache();

    } catch (error) {
      throw new Error(`Failed to update ${category} configuration: ${error}`);
    }
  }

  // Build configuration from database settings
  private async buildConfigFromSettings(settings: any[]): Promise<AppConfig> {
    const settingsMap = new Map<string, Map<string, any>>();
    
    // Group settings by category
    settings.forEach(setting => {
      if (!settingsMap.has(setting.category)) {
        settingsMap.set(setting.category, new Map());
      }
      settingsMap.get(setting.category)!.set(setting.key, setting.value);
    });

    return {
      general: this.buildGeneralConfig(settingsMap.get('general')),
      features: this.buildFeaturesConfig(settingsMap.get('features')),
      security: this.buildSecurityConfig(settingsMap.get('security')),
      aws: this.buildAWSConfig(settingsMap.get('aws')),
      email: this.buildEmailConfig(settingsMap.get('email')),
      coturn: this.buildCOTURNConfig(settingsMap.get('coturn')),
      pushNotifications: this.buildPushNotificationConfig(settingsMap.get('push_notifications'))
    };
  }

  private buildGeneralConfig(settings?: Map<string, any>): GeneralConfig {
    return {
      appName: settings?.get('app_name') || process.env.APP_NAME || 'WhatsApp Clone',
      appVersion: settings?.get('app_version') || process.env.APP_VERSION || '1.0.0',
      companyName: settings?.get('company_name') || process.env.COMPANY_NAME || 'WhatsApp Clone Inc.',
      supportEmail: settings?.get('support_email') || process.env.SUPPORT_EMAIL || 'support@whatsappclone.com',
      maxFileSize: settings?.get('max_file_size') || parseInt(process.env.MAX_FILE_SIZE || '16777216'),
      maintenanceMode: settings?.get('maintenance_mode') || process.env.MAINTENANCE_MODE === 'true'
    };
  }

  private buildFeaturesConfig(settings?: Map<string, any>): FeaturesConfig {
    return {
      groupMaxMembers: settings?.get('group_max_members') || parseInt(process.env.GROUP_MAX_MEMBERS || '256'),
      disappearingMessages: settings?.get('disappearing_messages') ?? (process.env.DISAPPEARING_MESSAGES !== 'false'),
      statusMaxDurationSeconds: settings?.get('status_max_duration_seconds') || parseInt(process.env.STATUS_MAX_DURATION_SECONDS || '86400'),
      voiceCallEnabled: settings?.get('voice_call_enabled') ?? (process.env.VOICE_CALL_ENABLED !== 'false'),
      videoCallEnabled: settings?.get('video_call_enabled') ?? (process.env.VIDEO_CALL_ENABLED !== 'false'),
      maxCallParticipants: settings?.get('max_call_participants') || parseInt(process.env.MAX_CALL_PARTICIPANTS || '8'),
      broadcastEnabled: settings?.get('broadcast_enabled') ?? (process.env.BROADCAST_ENABLED !== 'false'),
      messageReactionsEnabled: settings?.get('message_reactions_enabled') ?? (process.env.MESSAGE_REACTIONS_ENABLED !== 'false')
    };
  }

  private buildSecurityConfig(settings?: Map<string, any>): SecurityConfig {
    return {
      jwt: {
        accessTokenSecret: this.getSecretOrThrow('JWT_SECRET'),
        refreshTokenSecret: this.getSecretOrThrow('JWT_REFRESH_SECRET'),
        qrTokenSecret: this.getSecretOrThrow('JWT_QR_SECRET', process.env.JWT_SECRET!),
        adminTokenSecret: this.getSecretOrThrow('JWT_ADMIN_SECRET', process.env.JWT_SECRET!),
        accessTokenExpiry: settings?.get('jwt_access_token_expiry') || process.env.JWT_ACCESS_TOKEN_EXPIRY || '1h',
        refreshTokenExpiry: settings?.get('jwt_refresh_token_expiry') || process.env.JWT_REFRESH_TOKEN_EXPIRY || '30d',
        qrTokenExpiry: settings?.get('jwt_qr_token_expiry') || process.env.JWT_QR_TOKEN_EXPIRY || '5m',
        adminTokenExpiry: settings?.get('jwt_admin_token_expiry') || process.env.JWT_ADMIN_TOKEN_EXPIRY || '8h',
        issuer: settings?.get('jwt_issuer') || process.env.JWT_ISSUER || 'whatsapp-clone',
        audience: settings?.get('jwt_audience') || process.env.JWT_AUDIENCE || 'whatsapp-clone-users'
      },
      otp: {
        length: settings?.get('otp_length') || parseInt(process.env.OTP_LENGTH || '6'),
        expiryMinutes: settings?.get('otp_expiry_minutes') || parseInt(process.env.OTP_EXPIRY_MINUTES || '5'),
        maxAttempts: settings?.get('otp_max_attempts') || parseInt(process.env.OTP_MAX_ATTEMPTS || '3'),
        resendCooldown: settings?.get('otp_resend_cooldown') || parseInt(process.env.OTP_RESEND_COOLDOWN || '60'),
        rateLimitMinutes: settings?.get('otp_rate_limit_minutes') || parseInt(process.env.OTP_RATE_LIMIT_MINUTES || '1')
      },
      qr: {
        sessionExpiryMinutes: settings?.get('qr_session_expiry_minutes') || parseInt(process.env.QR_SESSION_EXPIRY_MINUTES || '5'),
        maxConcurrentSessions: settings?.get('qr_max_concurrent_sessions') || parseInt(process.env.QR_MAX_CONCURRENT_SESSIONS || '3'),
        allowedOrigins: settings?.get('qr_allowed_origins') || ['*']
      },
      bcryptRounds: settings?.get('bcrypt_rounds') || parseInt(process.env.BCRYPT_ROUNDS || '12'),
      maxLoginAttempts: settings?.get('max_login_attempts') || parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5'),
      lockoutDurationMinutes: settings?.get('lockout_duration_minutes') || parseInt(process.env.LOCKOUT_DURATION_MINUTES || '15'),
      sessionTimeoutMinutes: settings?.get('session_timeout_minutes') || parseInt(process.env.SESSION_TIMEOUT_MINUTES || '60'),
      requireTwoFactor: settings?.get('require_two_factor') || process.env.REQUIRE_TWO_FACTOR === 'true',
      allowedDevicesPerUser: settings?.get('allowed_devices_per_user') || parseInt(process.env.ALLOWED_DEVICES_PER_USER || '5'),
      rateLimit: {
        loginWindowMs: settings?.get('rate_limit_login_window_ms') || 900000,
        loginMaxAttempts: settings?.get('rate_limit_login_max_attempts') || 5,
        otpWindowMs: settings?.get('rate_limit_otp_window_ms') || 300000,
        otpMaxAttempts: settings?.get('rate_limit_otp_max_attempts') || 3,
        qrWindowMs: settings?.get('rate_limit_qr_window_ms') || 600000,
        qrMaxAttempts: settings?.get('rate_limit_qr_max_attempts') || 10
      },
      admin: {
        defaultRole: settings?.get('admin_default_role') || process.env.ADMIN_DEFAULT_ROLE || 'support',
        sessionTimeoutHours: settings?.get('admin_session_timeout_hours') || parseInt(process.env.ADMIN_SESSION_TIMEOUT_HOURS || '8'),
        requireMfa: settings?.get('admin_require_mfa') ?? (process.env.ADMIN_REQUIRE_MFA !== 'false')
      }
    };
  }

  private buildAWSConfig(settings?: Map<string, any>): AWSConfig {
    return {
      region: settings?.get('region') || process.env.AWS_REGION || 'us-east-1',
      s3Bucket: settings?.get('s3_bucket') || process.env.AWS_S3_BUCKET || 'whatsapp-clone-storage',
      s3BucketPublic: settings?.get('s3_bucket_public') || process.env.AWS_S3_BUCKET_PUBLIC || 'whatsapp-clone-public',
      cloudfrontDomain: settings?.get('cloudfront_domain') || process.env.AWS_CLOUDFRONT_DOMAIN || '',
      sesSenderEmail: settings?.get('ses_sender_email') || process.env.EMAIL_FROM || 'noreply@whatsappclone.com',
      sesSenderName: settings?.get('ses_sender_name') || process.env.EMAIL_FROM_NAME || 'WhatsApp Clone',
      snsTopicArn: settings?.get('sns_topic_arn') || process.env.AWS_SNS_TOPIC_ARN || '',
      lambdaFunctionPrefix: settings?.get('lambda_function_prefix') || process.env.AWS_LAMBDA_FUNCTION_PREFIX || 'whatsapp-clone'
    };
  }

  private buildEmailConfig(settings?: Map<string, any>): EmailConfig {
    return {
      provider: settings?.get('provider') || process.env.EMAIL_PROVIDER || 'ses',
      fromEmail: settings?.get('from_email') || process.env.EMAIL_FROM || 'noreply@whatsappclone.com',
      fromName: settings?.get('from_name') || process.env.EMAIL_FROM_NAME || 'WhatsApp Clone',
      replyToEmail: settings?.get('reply_to_email') || process.env.EMAIL_REPLY_TO || 'support@whatsappclone.com',
      smtp: {
        host: settings?.get('smtp_host') || process.env.SMTP_HOST || '',
        port: settings?.get('smtp_port') || parseInt(process.env.SMTP_PORT || '587'),
        secure: settings?.get('smtp_secure') ?? (process.env.SMTP_SECURE === 'true'),
        username: settings?.get('smtp_username') || process.env.SMTP_USER || '',
        password: settings?.get('smtp_password') || process.env.SMTP_PASS || ''
      },
      templates: {
        welcomeEnabled: settings?.get('welcome_template_enabled') ?? true,
        otpEnabled: settings?.get('otp_template_enabled') ?? true,
        passwordResetEnabled: settings?.get('password_reset_template_enabled') ?? true
      }
    };
  }

  private buildCOTURNConfig(settings?: Map<string, any>): COTURNConfig {
    const stunServers = settings?.get('stun_servers') || 
      (process.env.STUN_SERVERS ? process.env.STUN_SERVERS.split(',') : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']);
    
    const turnServers = settings?.get('turn_servers') || 
      (process.env.TURN_SERVERS ? JSON.parse(process.env.TURN_SERVERS) : []);

    return {
      enabled: settings?.get('enabled') ?? (process.env.COTURN_ENABLED !== 'false'),
      stunServers,
      turnServers,
      turnUsername: settings?.get('turn_username') || process.env.TURN_USERNAME || '',
      turnPassword: settings?.get('turn_password') || process.env.TURN_PASSWORD || '',
      turnTtlSeconds: settings?.get('turn_ttl_seconds') || 86400,
      iceServersRefreshInterval: settings?.get('ice_servers_refresh_interval') || 3600,
      fallbackToPublicStun: settings?.get('fallback_to_public_stun') ?? true,
      videoBitrateMax: settings?.get('video_bitrate_max') || 2000000,
      audioBitrateMax: settings?.get('audio_bitrate_max') || 128000,
      callTimeoutSeconds: settings?.get('call_timeout_seconds') || 30
    };
  }

  private buildPushNotificationConfig(settings?: Map<string, any>): PushNotificationConfig {
    return {
      enabled: settings?.get('enabled') ?? true,
      provider: settings?.get('provider') || 'fcm',
      fcm: {
        serverKey: settings?.get('fcm_server_key') || process.env.FCM_SERVER_KEY || '',
        senderId: settings?.get('fcm_sender_id') || process.env.FCM_SENDER_ID || '',
        projectId: settings?.get('fcm_project_id') || process.env.FCM_PROJECT_ID || ''
      },
      apns: {
        enabled: settings?.get('apns_enabled') ?? (process.env.APNS_ENABLED === 'true'),
        teamId: settings?.get('apns_team_id') || process.env.APNS_TEAM_ID || '',
        keyId: settings?.get('apns_key_id') || process.env.APNS_KEY_ID || '',
        bundleId: settings?.get('apns_bundle_id') || process.env.APNS_BUNDLE_ID || 'com.whatsappclone.app',
        production: settings?.get('apns_production') ?? (process.env.APNS_PRODUCTION === 'true')
      },
      webPush: {
        enabled: settings?.get('web_push_enabled') ?? true,
        vapidPublicKey: settings?.get('vapid_public_key') || process.env.VAPID_PUBLIC_KEY || '',
        vapidPrivateKey: settings?.get('vapid_private_key') || process.env.VAPID_PRIVATE_KEY || '',
        vapidSubject: settings?.get('vapid_subject') || process.env.VAPID_SUBJECT || 'mailto:support@whatsappclone.com'
      },
      behavior: {
        defaultSound: settings?.get('default_sound') || 'default',
        badgeEnabled: settings?.get('badge_enabled') ?? true,
        groupNotifications: settings?.get('group_notifications') ?? true,
        callNotifications: settings?.get('call_notifications') ?? true,
        quietHoursEnabled: settings?.get('quiet_hours_enabled') ?? false,
        quietHoursStart: settings?.get('quiet_hours_start') || '22:00',
        quietHoursEnd: settings?.get('quiet_hours_end') || '08:00'
      }
    };
  }

  // Helper method to get secrets with fallback
  private getSecretOrThrow(envVar: string, fallback?: string): string {
    const secret = process.env[envVar] || fallback;
    if (!secret) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
    return secret;
  }

  // Convert camelCase to snake_case for database keys
  private convertToSettingKey(key: string): string {
    return key.replace(/([A-Z])/g, '_$1').toLowerCase();
  }

  // Get default configuration as fallback
  private getDefaultConfig(): AppConfig {
    return {
      general: {
        appName: 'WhatsApp Clone',
        appVersion: '1.0.0',
        companyName: 'WhatsApp Clone Inc.',
        supportEmail: 'support@whatsappclone.com',
        maxFileSize: 16777216,
        maintenanceMode: false
      },
      features: {
        groupMaxMembers: 256,
        disappearingMessages: true,
        statusMaxDurationSeconds: 86400,
        voiceCallEnabled: true,
        videoCallEnabled: true,
        maxCallParticipants: 8,
        broadcastEnabled: true,
        messageReactionsEnabled: true
      },
      security: {
        jwt: {
          accessTokenSecret: process.env.JWT_SECRET || 'fallback-secret',
          refreshTokenSecret: process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret',
          qrTokenSecret: process.env.JWT_QR_SECRET || 'fallback-qr-secret',
          adminTokenSecret: process.env.JWT_ADMIN_SECRET || 'fallback-admin-secret',
          accessTokenExpiry: '1h',
          refreshTokenExpiry: '30d',
          qrTokenExpiry: '5m',
          adminTokenExpiry: '8h',
          issuer: 'whatsapp-clone',
          audience: 'whatsapp-clone-users'
        },
        otp: {
          length: 6,
          expiryMinutes: 5,
          maxAttempts: 3,
          resendCooldown: 60,
          rateLimitMinutes: 1
        },
        qr: {
          sessionExpiryMinutes: 5,
          maxConcurrentSessions: 3,
          allowedOrigins: ['*']
        },
        bcryptRounds: 12,
        maxLoginAttempts: 5,
        lockoutDurationMinutes: 15,
        sessionTimeoutMinutes: 60,
        requireTwoFactor: false,
        allowedDevicesPerUser: 5,
        rateLimit: {
          loginWindowMs: 900000,
          loginMaxAttempts: 5,
          otpWindowMs: 300000,
          otpMaxAttempts: 3,
          qrWindowMs: 600000,
          qrMaxAttempts: 10
        },
        admin: {
          defaultRole: 'support',
          sessionTimeoutHours: 8,
          requireMfa: true
        }
      },
      aws: {
        region: 'us-east-1',
        s3Bucket: 'whatsapp-clone-storage',
        s3BucketPublic: 'whatsapp-clone-public',
        cloudfrontDomain: '',
        sesSenderEmail: 'noreply@whatsappclone.com',
        sesSenderName: 'WhatsApp Clone',
        snsTopicArn: '',
        lambdaFunctionPrefix: 'whatsapp-clone'
      },
      email: {
        provider: 'ses',
        fromEmail: 'noreply@whatsappclone.com',
        fromName: 'WhatsApp Clone',
        replyToEmail: 'support@whatsappclone.com',
        smtp: {
          host: '',
          port: 587,
          secure: true,
          username: '',
          password: ''
        },
        templates: {
          welcomeEnabled: true,
          otpEnabled: true,
          passwordResetEnabled: true
        }
      },
      coturn: {
        enabled: true,
        stunServers: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
        turnServers: [],
        turnUsername: '',
        turnPassword: '',
        turnTtlSeconds: 86400,
        iceServersRefreshInterval: 3600,
        fallbackToPublicStun: true,
        videoBitrateMax: 2000000,
        audioBitrateMax: 128000,
        callTimeoutSeconds: 30
      },
      pushNotifications: {
        enabled: true,
        provider: 'fcm',
        fcm: {
          serverKey: '',
          senderId: '',
          projectId: ''
        },
        apns: {
          enabled: false,
          teamId: '',
          keyId: '',
          bundleId: 'com.whatsappclone.app',
          production: false
        },
        webPush: {
          enabled: true,
          vapidPublicKey: '',
          vapidPrivateKey: '',
          vapidSubject: 'mailto:support@whatsappclone.com'
        },
        behavior: {
          defaultSound: 'default',
          badgeEnabled: true,
          groupNotifications: true,
          callNotifications: true,
          quietHoursEnabled: false,
          quietHoursStart: '22:00',
          quietHoursEnd: '08:00'
        }
      }
    };
  }

  // Clear configuration cache
  clearCache(): void {
    this.config = null;
    this.lastFetched = 0;
  }
}

// Singleton instance
export const AppConfig = AppConfigService.getInstance();