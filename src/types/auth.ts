import { DeviceInfo, UserStatus } from "./api";

export interface AuthUser {
  _id: string;
  phoneNumber: string;
  countryCode: string;
  displayName: string;
  username?: string;
  avatar?: string;
  isVerified: boolean;
  status: UserStatus;
}

export interface LoginRequest {
  phoneNumber: string;
  countryCode: string;
  otp: string;
}

export interface RegisterRequest {
  phoneNumber: string;
  countryCode: string;
  displayName: string;
  email?: string;
  username?: string;
}

export interface QRLoginRequest {
  qrToken: string;
  deviceInfo: DeviceInfo;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface AuthResponse {
  success: boolean;
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface OTPResponse {
  success: boolean;
  message: string;
  userId: string;
  expiresIn: number;
}

export interface QRCodeResponse {
  qrToken: string;
  qrCodeUrl: string;
  expiresIn: number;
}

export interface VerifyOTPRequest {
  userId: string;
  otp: string;
}

export interface JWTPayload {
  userId: string;
  phoneNumber: string;
  deviceId: string;
  iat: number;
  exp: number;
}
