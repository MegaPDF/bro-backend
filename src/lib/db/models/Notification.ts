import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  _id: string;
  userId: mongoose.Types.ObjectId;
  type: 'message' | 'call' | 'group_invite' | 'status_view' | 'system' | 'broadcast' | 'mention' | 'reminder';
  title: string;
  body: string;
  data: {
    chatId?: mongoose.Types.ObjectId;
    messageId?: mongoose.Types.ObjectId;
    callId?: mongoose.Types.ObjectId;
    groupId?: mongoose.Types.ObjectId;
    statusId?: mongoose.Types.ObjectId;
    senderId?: mongoose.Types.ObjectId;
    action?: string;
    [key: string]: any;
  };
  
  // Basic notification state
  isRead: boolean;
  readAt?: Date;
  isSent: boolean;
  sentAt?: Date;
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'failed' | 'scheduled';
  
  // Platform-specific delivery tracking
  platformDelivery: {
    platform: 'ios' | 'android' | 'web';
    deviceTokens: string[];
    status: 'pending' | 'sent' | 'delivered' | 'failed';
    sentAt?: Date;
    deliveredAt?: Date;
    failureReason?: string;
    retryCount: number;
    lastRetryAt?: Date;
    messageId?: string; // FCM/APNS message ID
  }[];
  
  // Notification content and appearance
  priority: 'low' | 'normal' | 'high' | 'critical';
  sound?: string;
  badge?: number;
  icon?: string;
  image?: string;
  color?: string;
  
  // iOS specific
  ios: {
    category?: string;
    threadId?: string;
    subtitle?: string;
    sound?: string;
    badge?: number;
    mutableContent?: boolean;
    contentAvailable?: boolean;
    interruptionLevel?: 'passive' | 'active' | 'timeSensitive' | 'critical';
    relevanceScore?: number;
  };
  
  // Android specific
  android: {
    channelId?: string;
    tag?: string;
    group?: string;
    groupSummary?: boolean;
    color?: string;
    icon?: string;
    largeIcon?: string;
    bigText?: string;
    bigPicture?: string;
    vibrationPattern?: number[];
    lights?: {
      color: string;
      onMs: number;
      offMs: number;
    };
    sticky?: boolean;
    localOnly?: boolean;
    ongoing?: boolean;
    autoCancel?: boolean;
    timeoutAfter?: number;
    showWhen?: boolean;
    when?: Date;
    usesChronometer?: boolean;
    chronometerCountDown?: boolean;
  };
  
  // Web specific
  web: {
    icon?: string;
    image?: string;
    badge?: string;
    tag?: string;
    requireInteraction?: boolean;
    silent?: boolean;
    timestamp?: number;
    vibrate?: number[];
    actions?: {
      action: string;
      title: string;
      icon?: string;
    }[];
    dir?: 'auto' | 'ltr' | 'rtl';
    lang?: string;
    clickAction?: string;
  };
  
  // Scheduling and expiry
  scheduledFor?: Date;
  expiresAt?: Date;
  timeToLive?: number; // seconds
  
  // Retry mechanism
  retryPolicy: {
    maxRetries: number;
    retryInterval: number; // seconds
    backoffMultiplier: number;
  };
  
  // Analytics and tracking
  tracking: {
    sent: number;
    delivered: number;
    failed: number;
    clicked: number;
    dismissed: number;
    lastInteraction?: Date;
  };
  
  // Grouping and categorization
  group?: string;
  thread?: string;
  collapseKey?: string;
  
  // Metadata
  metadata: {
    source?: string; // where the notification originated
    campaign?: string; // marketing campaign ID
    experiment?: string; // A/B testing experiment
    version?: string; // notification template version
    [key: string]: any;
  };
  
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['message', 'call', 'group_invite', 'status_view', 'system', 'broadcast', 'mention', 'reminder'],
    required: true 
  },
  title: { type: String, required: true },
  body: { type: String, required: true },
  data: {
    chatId: { type: Schema.Types.ObjectId, ref: 'Chat' },
    messageId: { type: Schema.Types.ObjectId, ref: 'Message' },
    callId: { type: Schema.Types.ObjectId, ref: 'Call' },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group' },
    statusId: { type: Schema.Types.ObjectId, ref: 'Status' },
    senderId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String },
    additionalData: { type: Schema.Types.Mixed }
  },
  
  // Basic notification state
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
  isSent: { type: Boolean, default: false },
  sentAt: { type: Date },
  deliveryStatus: { 
    type: String, 
    enum: ['pending', 'sent', 'delivered', 'failed', 'scheduled'],
    default: 'pending'
  },
  
  // Platform-specific delivery tracking
  platformDelivery: [{
    platform: { 
      type: String, 
      enum: ['ios', 'android', 'web'],
      required: true
    },
    deviceTokens: [{ type: String, required: true }],
    status: { 
      type: String, 
      enum: ['pending', 'sent', 'delivered', 'failed'],
      default: 'pending'
    },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    failureReason: { type: String },
    retryCount: { type: Number, default: 0 },
    lastRetryAt: { type: Date },
    messageId: { type: String } // FCM/APNS response message ID
  }],
  
  // Notification content and appearance
  priority: { 
    type: String, 
    enum: ['low', 'normal', 'high', 'critical'], 
    default: 'normal' 
  },
  sound: { type: String },
  badge: { type: Number },
  icon: { type: String },
  image: { type: String },
  color: { type: String },
  
  // iOS specific
  ios: {
    category: { type: String },
    threadId: { type: String },
    subtitle: { type: String },
    sound: { type: String },
    badge: { type: Number },
    mutableContent: { type: Boolean, default: false },
    contentAvailable: { type: Boolean, default: false },
    interruptionLevel: { 
      type: String, 
      enum: ['passive', 'active', 'timeSensitive', 'critical'],
      default: 'active'
    },
    relevanceScore: { type: Number, min: 0, max: 1 }
  },
  
  // Android specific
  android: {
    channelId: { type: String },
    tag: { type: String },
    group: { type: String },
    groupSummary: { type: Boolean, default: false },
    color: { type: String },
    icon: { type: String },
    largeIcon: { type: String },
    bigText: { type: String },
    bigPicture: { type: String },
    vibrationPattern: [{ type: Number }],
    lights: {
      color: { type: String },
      onMs: { type: Number },
      offMs: { type: Number }
    },
    sticky: { type: Boolean, default: false },
    localOnly: { type: Boolean, default: false },
    ongoing: { type: Boolean, default: false },
    autoCancel: { type: Boolean, default: true },
    timeoutAfter: { type: Number },
    showWhen: { type: Boolean, default: true },
    when: { type: Date },
    usesChronometer: { type: Boolean, default: false },
    chronometerCountDown: { type: Boolean, default: false }
  },
  
  // Web specific
  web: {
    icon: { type: String },
    image: { type: String },
    badge: { type: String },
    tag: { type: String },
    requireInteraction: { type: Boolean, default: false },
    silent: { type: Boolean, default: false },
    timestamp: { type: Number },
    vibrate: [{ type: Number }],
    actions: [{
      action: { type: String, required: true },
      title: { type: String, required: true },
      icon: { type: String }
    }],
    dir: { type: String, enum: ['auto', 'ltr', 'rtl'], default: 'auto' },
    lang: { type: String },
    clickAction: { type: String }
  },
  
  // Scheduling and expiry
  scheduledFor: { type: Date },
  expiresAt: { type: Date },
  timeToLive: { type: Number }, // seconds
  
  // Retry mechanism
  retryPolicy: {
    maxRetries: { type: Number, default: 3 },
    retryInterval: { type: Number, default: 300 }, // 5 minutes
    backoffMultiplier: { type: Number, default: 2 }
  },
  
  // Analytics and tracking
  tracking: {
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 },
    dismissed: { type: Number, default: 0 },
    lastInteraction: { type: Date }
  },
  
  // Grouping and categorization
  group: { type: String },
  thread: { type: String },
  collapseKey: { type: String },
  
  // Metadata
  metadata: {
    source: { type: String },
    campaign: { type: String },
    experiment: { type: String },
    version: { type: String },
    additionalMetadata: { type: Schema.Types.Mixed }
  }
}, {
  timestamps: true
});

// Indexes for performance
NotificationSchema.index({ userId: 1 });
NotificationSchema.index({ type: 1 });
NotificationSchema.index({ isRead: 1 });
NotificationSchema.index({ deliveryStatus: 1 });
NotificationSchema.index({ createdAt: -1 });
NotificationSchema.index({ scheduledFor: 1 });
NotificationSchema.index({ expiresAt: 1 });
NotificationSchema.index({ 'platformDelivery.platform': 1, 'platformDelivery.status': 1 });
NotificationSchema.index({ priority: 1 });
NotificationSchema.index({ group: 1 });
NotificationSchema.index({ thread: 1 });
NotificationSchema.index({ collapseKey: 1 });

// Compound indexes for complex queries
NotificationSchema.index({ userId: 1, type: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ deliveryStatus: 1, scheduledFor: 1 });
NotificationSchema.index({ 'retryPolicy.maxRetries': 1, 'platformDelivery.retryCount': 1 });

// TTL index for automatic cleanup of expired notifications
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save middleware to set default values
NotificationSchema.pre('save', function(next) {
  // Set default expiry if not set (30 days)
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  
  // Initialize tracking if not set
  if (!this.tracking) {
    this.tracking = {
      sent: 0,
      delivered: 0,
      failed: 0,
      clicked: 0,
      dismissed: 0
    };
  }
  
  // Initialize retry policy if not set
  if (!this.retryPolicy) {
    this.retryPolicy = {
      maxRetries: 3,
      retryInterval: 300,
      backoffMultiplier: 2
    };
  }
  
  next();
});

// Instance methods
NotificationSchema.methods.markAsRead = function() {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

NotificationSchema.methods.markAsSent = function(platform?: string, messageId?: string) {
  this.isSent = true;
  this.sentAt = new Date();
  this.deliveryStatus = 'sent';
  
  // Update platform-specific delivery status
  if (platform) {
    const platformDelivery = this.platformDelivery.find((pd: any) => pd.platform === platform);
    if (platformDelivery) {
      platformDelivery.status = 'sent';
      platformDelivery.sentAt = new Date();
      if (messageId) {
        platformDelivery.messageId = messageId;
      }
    }
  }
  
  this.tracking.sent++;
  return this.save();
};

NotificationSchema.methods.markAsDelivered = function(platform?: string) {
  this.deliveryStatus = 'delivered';
  
  // Update platform-specific delivery status
  if (platform) {
    const platformDelivery = this.platformDelivery.find((pd: any) => pd.platform === platform);
    if (platformDelivery) {
      platformDelivery.status = 'delivered';
      platformDelivery.deliveredAt = new Date();
    }
  }
  
  this.tracking.delivered++;
  return this.save();
};

NotificationSchema.methods.markAsFailed = function(platform?: string, reason?: string) {
  this.deliveryStatus = 'failed';
  
  // Update platform-specific delivery status
  if (platform) {
    const platformDelivery = this.platformDelivery.find((pd: any) => pd.platform === platform);
    if (platformDelivery) {
      platformDelivery.status = 'failed';
      platformDelivery.failureReason = reason;
      platformDelivery.retryCount++;
      platformDelivery.lastRetryAt = new Date();
    }
  }
  
  this.tracking.failed++;
  return this.save();
};

NotificationSchema.methods.markAsClicked = function() {
  this.tracking.clicked++;
  this.tracking.lastInteraction = new Date();
  return this.save();
};

NotificationSchema.methods.markAsDismissed = function() {
  this.tracking.dismissed++;
  this.tracking.lastInteraction = new Date();
  return this.save();
};

NotificationSchema.methods.canRetry = function(platform?: string): boolean {
  if (platform) {
    const platformDelivery = this.platformDelivery.find((pd: any) => pd.platform === platform);
    return platformDelivery ? platformDelivery.retryCount < this.retryPolicy.maxRetries : false;
  }
  
  return this.platformDelivery.some((pd: any) => pd.retryCount < this.retryPolicy.maxRetries);
};

NotificationSchema.methods.getRetryDelay = function(platform?: string): number {
  let retryCount = 0;
  
  if (platform) {
    const platformDelivery = this.platformDelivery.find((pd: any) => pd.platform === platform);
    retryCount = platformDelivery ? platformDelivery.retryCount : 0;
  } else {
    retryCount = Math.max(...this.platformDelivery.map((pd: any) => pd.retryCount));
  }
  
  return this.retryPolicy.retryInterval * Math.pow(this.retryPolicy.backoffMultiplier, retryCount);
};

// Static methods
NotificationSchema.statics.findPendingNotifications = function() {
  return this.find({
    deliveryStatus: 'pending',
    $or: [
      { scheduledFor: { $exists: false } },
      { scheduledFor: { $lte: new Date() } }
    ],
    expiresAt: { $gt: new Date() }
  });
};

NotificationSchema.statics.findRetryableNotifications = function() {
  return this.find({
    deliveryStatus: 'failed',
    'platformDelivery.retryCount': { $lt: '$retryPolicy.maxRetries' },
    expiresAt: { $gt: new Date() }
  });
};

NotificationSchema.statics.findScheduledNotifications = function() {
  return this.find({
    deliveryStatus: 'scheduled',
    scheduledFor: { $lte: new Date() },
    expiresAt: { $gt: new Date() }
  });
};

export default mongoose.models.Notification || mongoose.model<INotification>('Notification', NotificationSchema);