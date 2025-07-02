// User types that exactly match the actual User model schema

export type UserStatus = 'active' | 'blocked' | 'suspended' | 'deleted';
export type PrivacyLevel = 'everyone' | 'contacts' | 'nobody';

// Main User interface that exactly matches /lib/db/models/User.ts
export interface IUser {
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
  status: UserStatus;
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
    lastSeen: PrivacyLevel;
    profilePhoto: PrivacyLevel;
    about: PrivacyLevel;
    readReceipts: boolean;
    groups: PrivacyLevel;
    calls: PrivacyLevel;
    status: PrivacyLevel;
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
  contacts: string[]; // mongoose.Types.ObjectId[] as strings
  blockedUsers: string[]; // mongoose.Types.ObjectId[] as strings
  tempOTP?: string;
  tempOTPExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Request/Response types
export interface UserCreateRequest {
  phoneNumber: string;
  countryCode: string;
  displayName: string;
  email?: string;
  username?: string;
}

export interface UserUpdateRequest {
  displayName?: string;
  about?: string;
  avatar?: string;
  username?: string;
  privacySettings?: Partial<{
    lastSeen: PrivacyLevel;
    profilePhoto: PrivacyLevel;
    about: PrivacyLevel;
    readReceipts: boolean;
    groups: PrivacyLevel;
    calls: PrivacyLevel;
    status: PrivacyLevel;
  }>;
  securitySettings?: Partial<{
    twoFactorEnabled: boolean;
    backupEnabled: boolean;
    disappearingMessages: number;
    fingerprintLock: boolean;
    autoDownloadMedia: boolean;
  }>;
  notificationSettings?: Partial<{
    messageNotifications: boolean;
    groupNotifications: boolean;
    callNotifications: boolean;
    statusNotifications: boolean;
    sound: string;
    vibration: boolean;
    popupNotification: boolean;
  }>;
}

export interface UserResponse {
  user: IUser;
  isContact?: boolean;
  mutualGroups?: number;
}

export interface UserSearchResponse {
  users: UserResponse[];
  total: number;
  page: number;
  limit: number;
}

// Device management types that match the actual schema
export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  appVersion: string;
  pushToken?: string;
}

export interface AddDeviceRequest {
  deviceInfo: DeviceInfo;
}

export interface UpdateDeviceRequest {
  deviceId: string;
  pushToken?: string;
  deviceName?: string;
}

export default IUser;