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
  deviceTokens: string[];
  devices: {
    deviceId: string;
    deviceName: string;
    platform: string;
    appVersion: string;
    lastActive: Date;
    pushToken?: string;
  }[];
  privacySettings: {
    lastSeen: 'everyone' | 'contacts' | 'nobody';
    profilePhoto: 'everyone' | 'contacts' | 'nobody';
    about: 'everyone' | 'contacts' | 'nobody';
    readReceipts: boolean;
    groups: 'everyone' | 'contacts' | 'nobody';
    calls: 'everyone' | 'contacts' | 'nobody';
    status: 'everyone' | 'contacts' | 'nobody';
  };
  securitySettings: {
    twoFactorEnabled: boolean;
    backupEnabled: boolean;
    disappearingMessages: number;
    fingerprintLock: boolean;
    autoDownloadMedia: boolean;
  };
  notificationSettings: {
    messageNotifications: boolean;
    groupNotifications: boolean;
    callNotifications: boolean;
    statusNotifications: boolean;
    sound: string;
    vibration: boolean;
    popupNotification: boolean;
  };
  contacts: mongoose.Types.ObjectId[];
  blockedUsers: mongoose.Types.ObjectId[];
  tempOTP?: string;
  tempOTPExpires?: Date;
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
  status: { type: String, enum: ['active', 'blocked', 'suspended', 'deleted'], default: 'active' },
  deviceTokens: [{ type: String }],
  devices: [{
    deviceId: { type: String, required: true },
    deviceName: { type: String, required: true },
    platform: { type: String, required: true },
    appVersion: { type: String, required: true },
    lastActive: { type: Date, default: Date.now },
    pushToken: { type: String }
  }],
  privacySettings: {
    lastSeen: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
    profilePhoto: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
    about: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
    readReceipts: { type: Boolean, default: true },
    groups: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
    calls: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
    status: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'contacts' }
  },
  securitySettings: {
    twoFactorEnabled: { type: Boolean, default: false },
    backupEnabled: { type: Boolean, default: true },
    disappearingMessages: { type: Number, default: 0 },
    fingerprintLock: { type: Boolean, default: false },
    autoDownloadMedia: { type: Boolean, default: true }
  },
  notificationSettings: {
    messageNotifications: { type: Boolean, default: true },
    groupNotifications: { type: Boolean, default: true },
    callNotifications: { type: Boolean, default: true },
    statusNotifications: { type: Boolean, default: true },
    sound: { type: String, default: 'default' },
    vibration: { type: Boolean, default: true },
    popupNotification: { type: Boolean, default: true }
  },
  contacts: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  blockedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  tempOTP: { type: String },
  tempOTPExpires: { type: Date }
}, {
  timestamps: true
});

UserSchema.index({ phoneNumber: 1 });
UserSchema.index({ username: 1 });
UserSchema.index({ email: 1 });
UserSchema.index({ status: 1 });
UserSchema.index({ isOnline: 1 });

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
