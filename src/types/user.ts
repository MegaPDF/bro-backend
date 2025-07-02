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
  devices: UserDevice[];
  privacySettings: UserPrivacySettings;
  securitySettings: UserSecuritySettings;
  notificationSettings: UserNotificationSettings;
  contacts: string[];
  blockedUsers: string[];
  tempOTP?: string;
  tempOTPExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDevice {
  deviceId: string;
  deviceName: string;
  platform: 'android' | 'ios' | 'web' | 'desktop';
  appVersion: string;
  lastActive: Date;
  pushToken?: string;
}

export interface UserPrivacySettings {
  lastSeen: PrivacyLevel;
  profilePhoto: PrivacyLevel;
  about: PrivacyLevel;
  readReceipts: boolean;
  groups: PrivacyLevel;
  calls: PrivacyLevel;
  status: PrivacyLevel;
}

export interface UserSecuritySettings {
  twoFactorEnabled: boolean;
  backupEnabled: boolean;
  disappearingMessages: number;
  fingerprintLock: boolean;
  autoDownloadMedia: boolean;
}

export interface UserNotificationSettings {
  messageNotifications: boolean;
  groupNotifications: boolean;
  callNotifications: boolean;
  statusNotifications: boolean;
  sound: string;
  vibration: boolean;
  popupNotification: boolean;
}

export type UserStatus = 'active' | 'blocked' | 'suspended' | 'deleted';
export type PrivacyLevel = 'everyone' | 'contacts' | 'nobody';

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
  privacySettings?: Partial<UserPrivacySettings>;
  securitySettings?: Partial<UserSecuritySettings>;
  notificationSettings?: Partial<UserNotificationSettings>;
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