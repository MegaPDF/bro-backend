// src/hooks/useAuth.ts

'use client';

import { useState, useEffect, useCallback, useContext, createContext, ReactNode } from 'react';
import { toast } from 'react-hot-toast';
import type { 
  AuthUser, 
  JWTPayload 
} from '@/types/auth';
import type { IUser } from '@/types/user';
import type { APIResponse } from '@/types/api';

// Authentication state interface
export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isVerifying: boolean;
  deviceId: string | null;
  sessionId: string | null;
  expiresAt: Date | null;
}

// OTP state interface
export interface OTPState {
  isGenerating: boolean;
  isVerifying: boolean;
  otpId: string | null;
  phoneNumber: string | null;
  email: string | null;
  expiresAt: Date | null;
  method: 'phone' | 'email' | null;
  cooldownSeconds: number;
}

// Auth context interface
export interface AuthContextType {
  // State
  authState: AuthState;
  otpState: OTPState;
  
  // Authentication methods
  generateOTP: (phoneNumber?: string, email?: string, method?: 'phone' | 'email') => Promise<{ success: boolean; error?: string }>;
  verifyOTP: (otpCode: string, otpId?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  
  // User methods
  updateProfile: (data: Partial<IUser>) => Promise<{ success: boolean; error?: string }>;
  uploadAvatar: (file: File) => Promise<{ success: boolean; avatarUrl?: string; error?: string }>;
  
  // QR Code authentication
  generateQRCode: () => Promise<{ success: boolean; qrCodeUrl?: string; sessionId?: string; error?: string }>;
  
  // Utility methods
  isTokenExpired: () => boolean;
  getRemainingTime: () => number;
}

// Hook configuration
export interface UseAuthOptions {
  autoRefresh?: boolean;
  refreshThreshold?: number; // Minutes before expiry to refresh
  persistSession?: boolean;
}

// Create auth context
const AuthContext = createContext<AuthContextType | null>(null);

// Auth provider component
export function AuthProvider({ 
  children, 
  options = {} 
}: { 
  children: ReactNode; 
  options?: UseAuthOptions;
}) {
  const auth = useAuthLogic(options);
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

// Hook to use auth context
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Main auth logic hook
function useAuthLogic(options: UseAuthOptions = {}): AuthContextType {
  const {
    autoRefresh = true,
    refreshThreshold = 10, // 10 minutes
    persistSession = true
  } = options;

  // Authentication state
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    isVerifying: false,
    deviceId: null,
    sessionId: null,
    expiresAt: null
  });

  // OTP state
  const [otpState, setOTPState] = useState<OTPState>({
    isGenerating: false,
    isVerifying: false,
    otpId: null,
    phoneNumber: null,
    email: null,
    expiresAt: null,
    method: null,
    cooldownSeconds: 0
  });

  // Generate unique device ID
  const generateDeviceId = useCallback((): string => {
    let deviceId = localStorage.getItem('device_id');
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem('device_id', deviceId);
    }
    return deviceId;
  }, []);

  // API helper function
  const apiRequest = useCallback(async <T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> => {
    const token = persistSession ? localStorage.getItem('access_token') : authState.sessionId;
    const deviceId = generateDeviceId();
    
    const response = await fetch(`/api${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
        'X-Device-ID': deviceId,
        ...options.headers
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Request failed');
    }

    return response.json();
  }, [authState.sessionId, persistSession, generateDeviceId]);

  // Initialize authentication state
  useEffect(() => {
    const initializeAuth = async () => {
      if (!persistSession) {
        setAuthState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      const token = localStorage.getItem('access_token');
      const refreshToken = localStorage.getItem('refresh_token');
      
      if (!token || !refreshToken) {
        setAuthState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      try {
        // Decode token to check expiry
        const payload = JSON.parse(atob(token.split('.')[1])) as JWTPayload;
        const isExpired = Date.now() >= payload.exp * 1000;

        if (isExpired) {
          // Try to refresh token
          await refreshAuthToken();
        } else {
          // Validate current token
          const response = await apiRequest<APIResponse & { user: AuthUser }>('/auth/me');
          
          if (response.success && response.user) {
            setAuthState({
              user: response.user,
              isAuthenticated: true,
              isLoading: false,
              isVerifying: false,
              deviceId: payload.deviceId,
              sessionId: token,
              expiresAt: new Date(payload.exp * 1000)
            });
          } else {
            clearAuthData();
          }
        }
      } catch (error) {
        console.error('Auth initialization failed:', error);
        clearAuthData();
      }
    };

    initializeAuth();
  }, []);

  // Clear authentication data
  const clearAuthData = useCallback(() => {
    if (persistSession) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    }
    
    setAuthState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isVerifying: false,
      deviceId: null,
      sessionId: null,
      expiresAt: null
    });
  }, [persistSession]);

  // Refresh auth token
  const refreshAuthToken = useCallback(async () => {
    try {
      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Token refresh failed');
      }

      if (data.success && data.accessToken && data.user) {
        const { accessToken, refreshToken: newRefreshToken, user, expiresIn } = data;
        
        if (persistSession) {
          localStorage.setItem('access_token', accessToken);
          if (newRefreshToken) {
            localStorage.setItem('refresh_token', newRefreshToken);
          }
        }

        const payload = JSON.parse(atob(accessToken.split('.')[1])) as JWTPayload;
        
        setAuthState({
          user,
          isAuthenticated: true,
          isLoading: false,
          isVerifying: false,
          deviceId: payload.deviceId,
          sessionId: accessToken,
          expiresAt: new Date(payload.exp * 1000)
        });

        return true;
      } else {
        throw new Error('Invalid refresh response');
      }
    } catch (error: any) {
      console.error('Token refresh failed:', error);
      clearAuthData();
      return false;
    }
  }, [persistSession, clearAuthData]);

  // Generate OTP
  const generateOTP = useCallback(async (
    phoneNumber?: string, 
    email?: string, 
    method: 'phone' | 'email' = 'phone'
  ) => {
    try {
      setOTPState(prev => ({ ...prev, isGenerating: true }));

      const deviceId = generateDeviceId();
      const response = await fetch('/api/auth/otp/generate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId
        },
        body: JSON.stringify({
          phoneNumber,
          email,
          method,
          deviceId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'OTP generation failed');
      }

      if (data.success && data.otpId) {
        setOTPState(prev => ({
          ...prev,
          isGenerating: false,
          otpId: data.otpId,
          phoneNumber: method === 'phone' ? phoneNumber || null : null,
          email: method === 'email' ? email || null : null,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          method,
          cooldownSeconds: data.cooldownSeconds || 0
        }));

        toast.success(`OTP sent to your ${method}`);
        return { success: true };
      } else {
        throw new Error('Invalid OTP generation response');
      }
    } catch (error: any) {
      console.error('OTP generation error:', error);
      setOTPState(prev => ({ ...prev, isGenerating: false }));
      toast.error(error.message || 'Failed to send OTP');
      return { success: false, error: error.message };
    }
  }, [generateDeviceId]);

  // Verify OTP
  const verifyOTP = useCallback(async (otpCode: string, otpId?: string) => {
    try {
      setOTPState(prev => ({ ...prev, isVerifying: true }));
      setAuthState(prev => ({ ...prev, isVerifying: true }));

      const deviceId = generateDeviceId();
      const response = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId
        },
        body: JSON.stringify({
          otp: otpCode,
          otpId: otpId || otpState.otpId,
          deviceId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'OTP verification failed');
      }

      if (data.success && data.user) {
        const { user, accessToken, refreshToken, expiresIn } = data;
        
        if (persistSession && accessToken && refreshToken) {
          localStorage.setItem('access_token', accessToken);
          localStorage.setItem('refresh_token', refreshToken);
        }

        const payload = accessToken ? JSON.parse(atob(accessToken.split('.')[1])) as JWTPayload : null;
        
        setAuthState({
          user,
          isAuthenticated: true,
          isLoading: false,
          isVerifying: false,
          deviceId: payload?.deviceId || deviceId,
          sessionId: accessToken,
          expiresAt: payload ? new Date(payload.exp * 1000) : null
        });

        setOTPState({
          isGenerating: false,
          isVerifying: false,
          otpId: null,
          phoneNumber: null,
          email: null,
          expiresAt: null,
          method: null,
          cooldownSeconds: 0
        });

        toast.success(data.isNewUser ? 'Account created successfully!' : 'Login successful!');
        return { success: true };
      } else {
        throw new Error('Invalid verification response');
      }
    } catch (error: any) {
      console.error('OTP verification error:', error);
      setOTPState(prev => ({ ...prev, isVerifying: false }));
      setAuthState(prev => ({ ...prev, isVerifying: false }));
      toast.error(error.message || 'OTP verification failed');
      return { success: false, error: error.message };
    }
  }, [otpState.otpId, generateDeviceId, persistSession]);

  // Logout
  const logout = useCallback(async () => {
    try {
      // Call logout endpoint to invalidate server-side session
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearAuthData();
      toast.success('Logged out successfully');
    }
  }, [apiRequest, clearAuthData]);

  // Refresh authentication
  const refreshAuth = useCallback(async () => {
    if (!authState.isAuthenticated) return;

    try {
      const response = await apiRequest<APIResponse & { user: AuthUser }>('/auth/me');
      
      if (response.success && response.user) {
        setAuthState(prev => ({
          ...prev,
          user: response.user
        }));
      }
    } catch (error) {
      console.error('Auth refresh failed:', error);
      await logout();
    }
  }, [authState.isAuthenticated, apiRequest, logout]);

  // Update user profile
  const updateProfile = useCallback(async (data: Partial<IUser>) => {
    try {
      const response = await apiRequest<APIResponse & { user: AuthUser }>('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(data)
      });

      if (response.success && response.user) {
        setAuthState(prev => ({
          ...prev,
          user: response.user
        }));
        
        toast.success('Profile updated successfully');
        return { success: true };
      }
    } catch (error: any) {
      console.error('Profile update error:', error);
      toast.error(error.message || 'Failed to update profile');
      return { success: false, error: error.message };
    }
  }, [apiRequest]);

  // Upload avatar
  const uploadAvatar = useCallback(async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('avatar', file);

      const token = persistSession ? localStorage.getItem('access_token') : authState.sessionId;
      const deviceId = generateDeviceId();

      const response = await fetch('/api/auth/avatar', {
        method: 'POST',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
          'X-Device-ID': deviceId
        },
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Avatar upload failed');
      }

      if (data.success && data.user) {
        setAuthState(prev => ({
          ...prev,
          user: data.user
        }));
        
        toast.success('Avatar updated successfully');
        return { success: true, avatarUrl: data.user.avatar };
      }
    } catch (error: any) {
      console.error('Avatar upload error:', error);
      toast.error(error.message || 'Failed to upload avatar');
      return { success: false, error: error.message };
    }
  }, [authState.sessionId, persistSession, generateDeviceId]);

  // Generate QR code for authentication
  const generateQRCode = useCallback(async () => {
    try {
      const deviceId = generateDeviceId();
      const response = await fetch('/api/auth/qr/generate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId
        },
        body: JSON.stringify({ deviceId })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'QR code generation failed');
      }

      if (data.success && data.qrCodeUrl && data.sessionId) {
        return { 
          success: true, 
          qrCodeUrl: data.qrCodeUrl, 
          sessionId: data.sessionId 
        };
      } else {
        throw new Error('Invalid QR code response');
      }
    } catch (error: any) {
      console.error('QR code generation error:', error);
      return { success: false, error: error.message };
    }
  }, [generateDeviceId]);

  // Token expiry helpers
  const isTokenExpired = useCallback((): boolean => {
    if (!authState.expiresAt) return true;
    return Date.now() >= authState.expiresAt.getTime();
  }, [authState.expiresAt]);

  const getRemainingTime = useCallback((): number => {
    if (!authState.expiresAt) return 0;
    return Math.max(0, authState.expiresAt.getTime() - Date.now());
  }, [authState.expiresAt]);

  // Auto-refresh token when approaching expiry
  useEffect(() => {
    if (!autoRefresh || !authState.isAuthenticated || !authState.expiresAt) return;

    const checkAndRefresh = () => {
      const timeUntilExpiry = getRemainingTime();
      const refreshThresholdMs = refreshThreshold * 60 * 1000; // Convert to milliseconds

      if (timeUntilExpiry <= refreshThresholdMs && timeUntilExpiry > 0) {
        refreshAuthToken();
      }
    };

    // Check immediately
    checkAndRefresh();

    // Set up interval to check periodically
    const interval = setInterval(checkAndRefresh, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [
    autoRefresh, 
    authState.isAuthenticated, 
    authState.expiresAt, 
    refreshThreshold, 
    getRemainingTime, 
    refreshAuthToken
  ]);

  // OTP cooldown timer
  useEffect(() => {
    if (otpState.cooldownSeconds <= 0) return;

    const timer = setInterval(() => {
      setOTPState(prev => ({
        ...prev,
        cooldownSeconds: Math.max(0, prev.cooldownSeconds - 1)
      }));
    }, 1000);

    return () => clearInterval(timer);
  }, [otpState.cooldownSeconds]);

  return {
    // State
    authState,
    otpState,
    
    // Authentication methods
    generateOTP,
    verifyOTP,
    logout,
    refreshAuth,
    
    // User methods
    updateProfile,
    uploadAvatar,
    
    // QR Code authentication
    generateQRCode,
    
    // Utility methods
    isTokenExpired,
    getRemainingTime
  };
}

// Standalone hook for use without context
export function useAuthStandalone(options: UseAuthOptions = {}): AuthContextType {
  return useAuthLogic(options);
}