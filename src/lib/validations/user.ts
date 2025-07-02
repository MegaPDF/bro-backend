import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  _id: string;
  phoneNumber: string;
  countryCode: string;
  username?: string;
  displayName: string;
  email?: string;
  avatar?: string;
  about?: string;
  isVerified: boolean;
  isOnline: boolean;
  lastSeen: Date;
  status: 'active' | 'blocked' | 'suspended' | 'deleted';
  
  // Enhanced device management
  devices: {
    deviceId: string;
    deviceName: string;
    platform: 'android' | 'ios' | 'web' | 'desktop';
    appVersion: string;
    osVersion?: string;
    model?: string;
    manufacturer?: string;
    lastActive: Date;
    isActive: boolean;
    
    // Push notification tokens
    pushToken?: string;
    fcmToken?: string; // Android/Web FCM token
    apnsToken?: string; // iOS APNS token
    vapidEndpoint?: string; // Web Push endpoint
    vapidKeys?: {
      p256dh: string;
      auth: string;
    };
    
    // Device-specific settings
    notificationSettings: {
      enabled: boolean;
      sound: boolean;
      vibration: boolean;
      badge: boolean;
      banner: boolean;
      lockScreen: boolean;
      notificationCenter: boolean;
      criticalAlerts: boolean;
    };
    
    // Security and verification
    isVerified: boolean;
    verifiedAt?: Date;
    fingerprint?: string;
    lastLocationUpdate?: Date;
    timezone?: string;
    language?: string;
    
    // Metadata
    userAgent?: string;
    ipAddress?: string;
    location?: {
      country?: string;
      region?: string;
      city?: string;
      coordinates?: {
        latitude: number;
        longitude: number;
      };
    };
    
    createdAt: Date;
    updatedAt: Date;
  }[];
  
  // Comprehensive notification settings
  notificationSettings: {
    // Global notification preferences
    globalSettings: {
      enabled: boolean;
      pauseAll: boolean;
      pauseUntil?: Date;
      quietHours: {
        enabled: boolean;
        startTime: string; // HH:MM format
        endTime: string; // HH:MM format
        timezone: string;
        days: ('monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday')[];
      };
    };
    
    // Message notifications
    messages: {
      enabled: boolean;
      sound: string;
      vibration: boolean;
      showPreview: boolean;
      groupNotifications: boolean;
      mentionOnly: boolean; // Only notify for mentions in groups
      priority: 'low' | 'normal' | 'high';
      
      // Platform-specific
      ios: {
        badge: boolean;
        banner: boolean;
        lockScreen: boolean;
        notificationCenter: boolean;
        criticalAlerts: boolean;
        interruptionLevel: 'passive' | 'active' | 'timeSensitive' | 'critical';
      };
      android: {
        channelId: string;
        vibrationPattern: number[];
        ledColor?: string;
        groupMessages: boolean;
        heads_up: boolean;
      };
      web: {
        desktop: boolean;
        icon: string;
        requireInteraction: boolean;
        silent: boolean;
      };
    };
    
    // Call notifications
    calls: {
      enabled: boolean;
      ringtone: string;
      vibration: boolean;
      flashLight: boolean;
      showCaller: boolean;
      callerId: boolean;
      
      // Platform-specific
      ios: {
        criticalAlerts: boolean;
        interruptionLevel: 'timeSensitive' | 'critical';
      };
      android: {
        fullScreenIntent: boolean;
        channelId: string;
        vibrationPattern: number[];
      };
      web: {
        permission: 'granted' | 'denied' | 'default';
        autoAnswer: boolean;
      };
    };
    
    // Group notifications
    groups: {
      enabled: boolean;
      sound: string;
      vibration: boolean;
      adminOnly: boolean;
      mentionOnly: boolean;
      showGroupName: boolean;
      
      // Per-group settings override
      groupOverrides: {
        groupId: mongoose.Types.ObjectId;
        enabled: boolean;
        sound?: string;
        vibration?: boolean;
        mentionOnly?: boolean;
        priority?: 'low' | 'normal' | 'high';
      }[];
    };
    
    // Status notifications  
    status: {
      enabled: boolean;
      sound: string;
      viewNotifications: boolean;
      newStatusFromContacts: boolean;
      newStatusFromAll: boolean;
    };
    
    // System notifications
    system: {
      enabled: boolean;
      securityAlerts: boolean;
      accountUpdates: boolean;
      featureUpdates: boolean;
      maintenanceNotices: boolean;
      marketing: boolean;
    };
    
    // Contact-specific overrides
    contactOverrides: {
      contactId: mongoose.Types.ObjectId;
      enabled: boolean;
      sound?: string;
      vibration?: boolean;
      priority?: 'low' | 'normal' | 'high';
      muteUntil?: Date;
    }[];
  };
  
  // Enhanced privacy settings
  privacySettings: {
    lastSeen: 'everyone' | 'contacts' | 'nobody';
    profilePhoto: 'everyone' | 'contacts' | 'nobody';
    about: 'everyone' | 'contacts' | 'nobody';
    readReceipts: boolean;
    typingIndicators: boolean;
    groups: 'everyone' | 'contacts' | 'nobody';
    calls: 'everyone' | 'contacts' | 'nobody';
    status: 'everyone' | 'contacts' | 'nobody';
    
    // Advanced privacy
    blockedContacts: mongoose.Types.ObjectId[];
    restrictedContacts: mongoose.Types.ObjectId[]; // Limited access
    allowedContacts: mongoose.Types.ObjectId[]; // Whitelist mode
    
    // Notification privacy
    notificationPrivacy: {
      hideContent: boolean; // Hide message content in notifications
      hideNameInGroups: boolean;
      anonymousNotifications: boolean;
    };
    
    // Data privacy
    dataCollection: {
      analytics: boolean;
      crashReports: boolean;
      performanceData: boolean;
      locationData: boolean;
    };
  };
  
  // Enhanced security settings
  securitySettings: {
    twoFactorEnabled: boolean;
    twoFactorSecret?: string;
    backupCodes?: string[];
    
    // Device security
    deviceTrust: {
      requireVerification: boolean;
      trustedDevices: string[]; // device IDs
      maxDevices: number;
      sessionTimeout: number; // minutes
    };
    
    // Message security
    endToEndEncryption: boolean;
    backupEnabled: boolean;
    disappearingMessages: number; // default duration
    
    // Biometric and PIN
    biometricLock: {
      enabled: boolean;
      type: 'fingerprint' | 'face' | 'voice' | 'pin';
      lockTimeout: number; // minutes
    };
    
    // Network security
    vpnRequired: boolean;
    allowPublicNetworks: boolean;
    
    // Advanced security
    securityNotifications: boolean;
    suspiciousActivityAlerts: boolean;
    loginAlerts: boolean;
    locationVerification: boolean;
  };
  
  // Push notification subscriptions
  pushSubscriptions: {
    platform: 'ios' | 'android' | 'web';
    endpoint?: string; // Web Push endpoint
    keys?: {
      p256dh: string;
      auth: string;
    }; // Web Push keys
    deviceToken: string;
    topics: string[]; // Subscribed FCM/APNS topics
    isActive: boolean;
    expiresAt?: Date;
    createdAt: Date;
    updatedAt: Date;
  }[];
  
  // Notification analytics and preferences
  notificationAnalytics: {
    totalSent: number;
    totalDelivered: number;
    totalOpened: number;
    totalClicked: number;
    totalDismissed: number;
    
    // Interaction patterns
    preferredTime: {
      hour: number; // 0-23
      dayOfWeek: number; // 0-6 (Sunday-Saturday)
    };
    
    // Delivery preferences learned from behavior
    optimalDelivery: {
      bestHours: number[]; // Hours when user most likely to engage
      worstHours: number[]; // Hours to avoid
      timezone: string;
      lastUpdated: Date;
    };
    
    // A/B testing participation
    experiments: {
      experimentId: string;
      variant: string;
      startDate: Date;
      endDate?: Date;
      metrics: {
        [key: string]: number;
      };
    }[];
  };
  
  // Contact management
  contacts: mongoose.Types.ObjectId[];
  blockedUsers: mongoose.Types.ObjectId[];
  mutedChats: {
    chatId: mongoose.Types.ObjectId;
    mutedUntil: Date;
    muteType: 'indefinite' | 'temporary';
  }[];
  
  // Business/Enterprise features
  businessProfile?: {
    isBusinessAccount: boolean;
    businessName?: string;
    businessCategory?: string;
    businessHours?: {
      [day: string]: {
        open: string;
        close: string;
        isOpen: boolean;
      };
    };
    autoReply?: {
      enabled: boolean;
      message: string;
      outsideHoursOnly: boolean;
    };
    notificationQuota: {
      daily: number;
      weekly: number;
      monthly: number;
      used: {
        daily: number;
        weekly: number;
        monthly: number;
      };
    };
  };
  
  // System fields
  tempOTP?: string;
  tempOTPExpires?: Date;
  emailVerificationToken?: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  
  // Account management
  accountLevel: 'free' | 'premium' | 'business' | 'enterprise';
  subscriptionExpires?: Date;
  featureFlags: {
    [featureName: string]: boolean;
  };
  
  // Audit trail
  lastPasswordChange?: Date;
  lastProfileUpdate?: Date;
  accountCreatedFrom: {
    platform: string;
    version: string;
    location?: string;
    ip?: string;
  };
  
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema({
  phoneNumber: { type: String, required: true, unique: true },
  countryCode: { type: String, required: true },
  username: { type: String, unique: true, sparse: true },
  displayName: { type: String, required: true },
  email: { type: String, unique: true, sparse: true },
  avatar: { type: String },
  about: { type: String, default: 'Available' },
  isVerified: { type: Boolean, default: false },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  status: { 
    type: String, 
    enum: ['active', 'blocked', 'suspended', 'deleted'], 
    default: 'active' 
  },
  
  // Enhanced devices
  devices: [{
    deviceId: { type: String, required: true },
    deviceName: { type: String, required: true },
    platform: { 
      type: String, 
      enum: ['android', 'ios', 'web', 'desktop'], 
      required: true 
    },
    appVersion: { type: String, required: true },
    osVersion: { type: String },
    model: { type: String },
    manufacturer: { type: String },
    lastActive: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
    
    // Push tokens
    pushToken: { type: String },
    fcmToken: { type: String },
    apnsToken: { type: String },
    vapidEndpoint: { type: String },
    vapidKeys: {
      p256dh: { type: String },
      auth: { type: String }
    },
    
    // Device notification settings
    notificationSettings: {
      enabled: { type: Boolean, default: true },
      sound: { type: Boolean, default: true },
      vibration: { type: Boolean, default: true },
      badge: { type: Boolean, default: true },
      banner: { type: Boolean, default: true },
      lockScreen: { type: Boolean, default: true },
      notificationCenter: { type: Boolean, default: true },
      criticalAlerts: { type: Boolean, default: false }
    },
    
    // Security
    isVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    fingerprint: { type: String },
    lastLocationUpdate: { type: Date },
    timezone: { type: String },
    language: { type: String, default: 'en' },
    
    // Metadata
    userAgent: { type: String },
    ipAddress: { type: String },
    location: {
      country: { type: String },
      region: { type: String },
      city: { type: String },
      coordinates: {
        latitude: { type: Number },
        longitude: { type: Number }
      }
    },
    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }],
  
  // Comprehensive notification settings
  notificationSettings: {
    globalSettings: {
      enabled: { type: Boolean, default: true },
      pauseAll: { type: Boolean, default: false },
      pauseUntil: { type: Date },
      quietHours: {
        enabled: { type: Boolean, default: false },
        startTime: { type: String, default: '22:00' },
        endTime: { type: String, default: '08:00' },
        timezone: { type: String, default: 'UTC' },
        days: [{ 
          type: String, 
          enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
          default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        }]
      }
    },
    
    messages: {
      enabled: { type: Boolean, default: true },
      sound: { type: String, default: 'default' },
      vibration: { type: Boolean, default: true },
      showPreview: { type: Boolean, default: true },
      groupNotifications: { type: Boolean, default: true },
      mentionOnly: { type: Boolean, default: false },
      priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
      
      ios: {
        badge: { type: Boolean, default: true },
        banner: { type: Boolean, default: true },
        lockScreen: { type: Boolean, default: true },
        notificationCenter: { type: Boolean, default: true },
        criticalAlerts: { type: Boolean, default: false },
        interruptionLevel: { 
          type: String, 
          enum: ['passive', 'active', 'timeSensitive', 'critical'],
          default: 'active'
        }
      },
      android: {
        channelId: { type: String, default: 'messages' },
        vibrationPattern: [{ type: Number, default: [0, 250, 250, 250] }],
        ledColor: { type: String },
        groupMessages: { type: Boolean, default: true },
        heads_up: { type: Boolean, default: true }
      },
      web: {
        desktop: { type: Boolean, default: true },
        icon: { type: String, default: '/notification-icon.png' },
        requireInteraction: { type: Boolean, default: false },
        silent: { type: Boolean, default: false }
      }
    },
    
    calls: {
      enabled: { type: Boolean, default: true },
      ringtone: { type: String, default: 'default' },
      vibration: { type: Boolean, default: true },
      flashLight: { type: Boolean, default: false },
      showCaller: { type: Boolean, default: true },
      callerId: { type: Boolean, default: true },
      
      ios: {
        criticalAlerts: { type: Boolean, default: true },
        interruptionLevel: { 
          type: String, 
          enum: ['timeSensitive', 'critical'],
          default: 'timeSensitive'
        }
      },
      android: {
        fullScreenIntent: { type: Boolean, default: true },
        channelId: { type: String, default: 'calls' },
        vibrationPattern: [{ type: Number, default: [0, 1000, 500, 1000] }]
      },
      web: {
        permission: { 
          type: String, 
          enum: ['granted', 'denied', 'default'],
          default: 'default'
        },
        autoAnswer: { type: Boolean, default: false }
      }
    },
    
    groups: {
      enabled: { type: Boolean, default: true },
      sound: { type: String, default: 'default' },
      vibration: { type: Boolean, default: true },
      adminOnly: { type: Boolean, default: false },
      mentionOnly: { type: Boolean, default: false },
      showGroupName: { type: Boolean, default: true },
      
      groupOverrides: [{
        groupId: { type: Schema.Types.ObjectId, ref: 'Group' },
        enabled: { type: Boolean, default: true },
        sound: { type: String },
        vibration: { type: Boolean },
        mentionOnly: { type: Boolean },
        priority: { type: String, enum: ['low', 'normal', 'high'] }
      }]
    },
    
    status: {
      enabled: { type: Boolean, default: true },
      sound: { type: String, default: 'default' },
      viewNotifications: { type: Boolean, default: true },
      newStatusFromContacts: { type: Boolean, default: true },
      newStatusFromAll: { type: Boolean, default: false }
    },
    
    system: {
      enabled: { type: Boolean, default: true },
      securityAlerts: { type: Boolean, default: true },
      accountUpdates: { type: Boolean, default: true },
      featureUpdates: { type: Boolean, default: true },
      maintenanceNotices: { type: Boolean, default: true },
      marketing: { type: Boolean, default: false }
    },
    
    contactOverrides: [{
      contactId: { type: Schema.Types.ObjectId, ref: 'User' },
      enabled: { type: Boolean, default: true },
      sound: { type: String },
      vibration: { type: Boolean },
      priority: { type: String, enum: ['low', 'normal', 'high'] },
      muteUntil: { type: Date }
    }]
  },
  
  // Enhanced privacy settings
  privacySettings: {
    lastSeen: { 
      type: String, 
      enum: ['everyone', 'contacts', 'nobody'], 
      default: 'everyone' 
    },
    profilePhoto: { 
      type: String, 
      enum: ['everyone', 'contacts', 'nobody'], 
      default: 'everyone' 
    },
    about: { 
      type: String, 
      enum: ['everyone', 'contacts', 'nobody'], 
      default: 'everyone' 
    },
    readReceipts: { type: Boolean, default: true },
    typingIndicators: { type: Boolean, default: true },
    groups: { 
      type: String, 
      enum: ['everyone', 'contacts', 'nobody'], 
      default: 'everyone' 
    },
    calls: { 
      type: String, 
      enum: ['everyone', 'contacts', 'nobody'], 
      default: 'everyone' 
    },
    status: { 
      type: String, 
      enum: ['everyone', 'contacts', 'nobody'], 
      default: 'contacts' 
    },
    
    blockedContacts: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    restrictedContacts: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    allowedContacts: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    
    notificationPrivacy: {
      hideContent: { type: Boolean, default: false },
      hideNameInGroups: { type: Boolean, default: false },
      anonymousNotifications: { type: Boolean, default: false }
    },
    
    dataCollection: {
      analytics: { type: Boolean, default: true },
      crashReports: { type: Boolean, default: true },
      performanceData: { type: Boolean, default: true },
      locationData: { type: Boolean, default: false }
    }
  },
  
  // Enhanced security settings
  securitySettings: {
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String },
    backupCodes: [{ type: String }],
    
    deviceTrust: {
      requireVerification: { type: Boolean, default: false },
      trustedDevices: [{ type: String }],
      maxDevices: { type: Number, default: 5 },
      sessionTimeout: { type: Number, default: 60 } // minutes
    },
    
    endToEndEncryption: { type: Boolean, default: true },
    backupEnabled: { type: Boolean, default: true },
    disappearingMessages: { type: Number, default: 0 },
    
    biometricLock: {
      enabled: { type: Boolean, default: false },
      type: { 
        type: String, 
        enum: ['fingerprint', 'face', 'voice', 'pin'] 
      },
      lockTimeout: { type: Number, default: 5 } // minutes
    },
    
    vpnRequired: { type: Boolean, default: false },
    allowPublicNetworks: { type: Boolean, default: true },
    
    securityNotifications: { type: Boolean, default: true },
    suspiciousActivityAlerts: { type: Boolean, default: true },
    loginAlerts: { type: Boolean, default: true },
    locationVerification: { type: Boolean, default: false }
  },
  
  // Push subscriptions
  pushSubscriptions: [{
    platform: { 
      type: String, 
      enum: ['ios', 'android', 'web'], 
      required: true 
    },
    endpoint: { type: String },
    keys: {
      p256dh: { type: String },
      auth: { type: String }
    },
    deviceToken: { type: String, required: true },
    topics: [{ type: String }],
    isActive: { type: Boolean, default: true },
    expiresAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }],
  
  // Notification analytics
  notificationAnalytics: {
    totalSent: { type: Number, default: 0 },
    totalDelivered: { type: Number, default: 0 },
    totalOpened: { type: Number, default: 0 },
    totalClicked: { type: Number, default: 0 },
    totalDismissed: { type: Number, default: 0 },
    
    preferredTime: {
      hour: { type: Number, min: 0, max: 23, default: 12 },
      dayOfWeek: { type: Number, min: 0, max: 6, default: 1 }
    },
    
    optimalDelivery: {
      bestHours: [{ type: Number, min: 0, max: 23 }],
      worstHours: [{ type: Number, min: 0, max: 23 }],
      timezone: { type: String, default: 'UTC' },
      lastUpdated: { type: Date, default: Date.now }
    },
    
    experiments: [{
      experimentId: { type: String, required: true },
      variant: { type: String, required: true },
      startDate: { type: Date, required: true },
      endDate: { type: Date },
      metrics: { type: Schema.Types.Mixed, default: {} }
    }]
  },
  
  // Contact management
  contacts: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  blockedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  mutedChats: [{
    chatId: { type: Schema.Types.ObjectId, ref: 'Chat' },
    mutedUntil: { type: Date },
    muteType: { type: String, enum: ['indefinite', 'temporary'], default: 'temporary' }
  }],
  
  // Business profile
  businessProfile: {
    isBusinessAccount: { type: Boolean, default: false },
    businessName: { type: String },
    businessCategory: { type: String },
    businessHours: { type: Schema.Types.Mixed },
    autoReply: {
      enabled: { type: Boolean, default: false },
      message: { type: String },
      outsideHoursOnly: { type: Boolean, default: true }
    },
    notificationQuota: {
      daily: { type: Number, default: 1000 },
      weekly: { type: Number, default: 7000 },
      monthly: { type: Number, default: 30000 },
      used: {
        daily: { type: Number, default: 0 },
        weekly: { type: Number, default: 0 },
        monthly: { type: Number, default: 0 }
      }
    }
  },
  
  // System fields
  tempOTP: { type: String },
  tempOTPExpires: { type: Date },
  emailVerificationToken: { type: String },
  emailVerified: { type: Boolean, default: false },
  phoneVerified: { type: Boolean, default: false },
  
  // Account management
  accountLevel: { 
    type: String, 
    enum: ['free', 'premium', 'business', 'enterprise'], 
    default: 'free' 
  },
  subscriptionExpires: { type: Date },
  featureFlags: { type: Schema.Types.Mixed, default: {} },
  
  // Audit trail
  lastPasswordChange: { type: Date },
  lastProfileUpdate: { type: Date },
  accountCreatedFrom: {
    platform: { type: String },
    version: { type: String },
    location: { type: String },
    ip: { type: String }
  }
}, {
  timestamps: true
});

// Indexes for performance
UserSchema.index({ phoneNumber: 1 });
UserSchema.index({ username: 1 });
UserSchema.index({ email: 1 });
UserSchema.index({ status: 1 });
UserSchema.index({ isOnline: 1 });
UserSchema.index({ 'devices.deviceId': 1 });
UserSchema.index({ 'devices.pushToken': 1 });
UserSchema.index({ 'devices.fcmToken': 1 });
UserSchema.index({ 'devices.apnsToken': 1 });
UserSchema.index({ 'pushSubscriptions.deviceToken': 1 });
UserSchema.index({ 'pushSubscriptions.platform': 1 });
UserSchema.index({ accountLevel: 1 });
UserSchema.index({ 'businessProfile.isBusinessAccount': 1 });

// Compound indexes
UserSchema.index({ status: 1, isOnline: 1 });
UserSchema.index({ 'devices.platform': 1, 'devices.isActive': 1 });
UserSchema.index({ 'notificationSettings.globalSettings.enabled': 1 });

// Instance methods
UserSchema.methods.addDevice = function(deviceInfo: any) {
  // Remove existing device with same deviceId
  this.devices = this.devices.filter((d: any) => d.deviceId !== deviceInfo.deviceId);
  
  // Add new device
  this.devices.push({
    ...deviceInfo,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  
  return this.save();
};

UserSchema.methods.removeDevice = function(deviceId: string) {
  this.devices = this.devices.filter((d: any) => d.deviceId !== deviceId);
  return this.save();
};

UserSchema.methods.updateDeviceActivity = function(deviceId: string) {
  const device = this.devices.find((d: any) => d.deviceId === deviceId);
  if (device) {
    device.lastActive = new Date();
    device.updatedAt = new Date();
  }
  return this.save();
};

UserSchema.methods.addPushSubscription = function(subscription: any) {
  // Remove existing subscription for same device token
  this.pushSubscriptions = this.pushSubscriptions.filter(
    (s: any) => s.deviceToken !== subscription.deviceToken
  );
  
  // Add new subscription
  this.pushSubscriptions.push({
    ...subscription,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  
  return this.save();
};

UserSchema.methods.removePushSubscription = function(deviceToken: string) {
  this.pushSubscriptions = this.pushSubscriptions.filter(
    (s: any) => s.deviceToken !== deviceToken
  );
  return this.save();
};

UserSchema.methods.getActiveDevices = function() {
  return this.devices.filter((d: any) => d.isActive);
};

UserSchema.methods.getPushTokens = function(platform?: string) {
  let subscriptions = this.pushSubscriptions.filter((s: any) => s.isActive);
  
  if (platform) {
    subscriptions = subscriptions.filter((s: any) => s.platform === platform);
  }
  
  return subscriptions.map((s: any) => s.deviceToken);
};

UserSchema.methods.canReceiveNotifications = function() {
  return this.notificationSettings.globalSettings.enabled && 
         !this.notificationSettings.globalSettings.pauseAll &&
         this.status === 'active';
};

UserSchema.methods.isInQuietHours = function() {
  const quietHours = this.notificationSettings.globalSettings.quietHours;
  
  if (!quietHours.enabled) return false;
  
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];
  
  // Check if current day is in quiet hours days
  if (!quietHours.days.includes(currentDay as any)) return false;
  
  const startHour = parseInt(quietHours.startTime.split(':')[0]);
  const endHour = parseInt(quietHours.endTime.split(':')[0]);
  
  // Handle overnight quiet hours (e.g., 22:00 to 08:00)
  if (startHour > endHour) {
    return currentHour >= startHour || currentHour < endHour;
  } else {
    return currentHour >= startHour && currentHour < endHour;
  }
};

// Static methods
UserSchema.statics.findByPushToken = function(pushToken: string) {
  return this.findOne({
    $or: [
      { 'devices.pushToken': pushToken },
      { 'devices.fcmToken': pushToken },
      { 'devices.apnsToken': pushToken },
      { 'pushSubscriptions.deviceToken': pushToken }
    ]
  });
};

UserSchema.statics.findUsersForPlatform = function(platform: string) {
  return this.find({
    'pushSubscriptions.platform': platform,
    'pushSubscriptions.isActive': true,
    status: 'active'
  });
};

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);