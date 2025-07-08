// src/hooks/useAdmin.ts

'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import type { 
  IAdmin, 
  AdminLoginRequest, 
  AdminCreateRequest, 
  AdminUpdateRequest,
  AdminPermissions,
  AdminRole
} from '@/types/admin';
import type { APIResponse } from '@/types/api';

// Admin authentication state
export interface AdminAuthState {
  admin: IAdmin | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  permissions: AdminPermissions | null;
  role: AdminRole | null;
  sessionId: string | null;
}

// Admin management state
export interface AdminManagementState {
  admins: IAdmin[];
  totalAdmins: number;
  currentPage: number;
  totalPages: number;
  isLoading: boolean;
  isCreating: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
}

// Analytics state
export interface AdminAnalyticsState {
  userStats: {
    total: number;
    active: number;
    verified: number;
    registeredToday: number;
  } | null;
  messageStats: {
    total: number;
    today: number;
    thisWeek: number;
    thisMonth: number;
  } | null;
  groupStats: {
    total: number;
    active: number;
    createdToday: number;
  } | null;
  systemStats: {
    storage: number;
    bandwidth: number;
    activeConnections: number;
  } | null;
  isLoading: boolean;
}

// Hook configuration
export interface UseAdminOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
  persistSession?: boolean;
}

export function useAdmin(options: UseAdminOptions = {}) {
  const {
    autoRefresh = false,
    refreshInterval = 30000,
    persistSession = true
  } = options;

  // Authentication state
  const [authState, setAuthState] = useState<AdminAuthState>({
    admin: null,
    isAuthenticated: false,
    isLoading: true,
    permissions: null,
    role: null,
    sessionId: null
  });

  // Management state
  const [managementState, setManagementState] = useState<AdminManagementState>({
    admins: [],
    totalAdmins: 0,
    currentPage: 1,
    totalPages: 1,
    isLoading: false,
    isCreating: false,
    isUpdating: false,
    isDeleting: false
  });

  // Analytics state
  const [analyticsState, setAnalyticsState] = useState<AdminAnalyticsState>({
    userStats: null,
    messageStats: null,
    groupStats: null,
    systemStats: null,
    isLoading: false
  });

  // API helper function
  const apiRequest = useCallback(async <T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> => {
    const token = persistSession ? localStorage.getItem('admin_token') : authState.sessionId;
    
    const response = await fetch(`/api/admin${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
        ...options.headers
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Request failed');
    }

    return response.json();
  }, [authState.sessionId, persistSession]);

  // Initialize authentication state
  useEffect(() => {
    const initializeAuth = async () => {
      if (!persistSession) {
        setAuthState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      const token = localStorage.getItem('admin_token');
      if (!token) {
        setAuthState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      try {
        const response = await apiRequest<APIResponse & { admin: IAdmin }>('/auth/me');
        
        if (response.success && response.admin) {
          setAuthState({
            admin: response.admin,
            isAuthenticated: true,
            isLoading: false,
            permissions: response.admin.permissions,
            role: response.admin.role,
            sessionId: token
          });
        } else {
          localStorage.removeItem('admin_token');
          setAuthState(prev => ({ ...prev, isLoading: false }));
        }
      } catch (error) {
        console.error('Auth initialization failed:', error);
        localStorage.removeItem('admin_token');
        setAuthState(prev => ({ ...prev, isLoading: false }));
      }
    };

    initializeAuth();
  }, [apiRequest, persistSession]);

  // Authentication methods
  const login = useCallback(async (credentials: AdminLoginRequest) => {
    try {
      setAuthState(prev => ({ ...prev, isLoading: true }));

      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      if (data.success && data.admin && data.accessToken) {
        const { admin, accessToken } = data;
        
        if (persistSession) {
          localStorage.setItem('admin_token', accessToken);
        }

        setAuthState({
          admin,
          isAuthenticated: true,
          isLoading: false,
          permissions: admin.permissions,
          role: admin.role,
          sessionId: accessToken
        });

        toast.success('Admin login successful');
        return { success: true, admin };
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error: any) {
      console.error('Admin login error:', error);
      setAuthState(prev => ({ ...prev, isLoading: false }));
      toast.error(error.message || 'Login failed');
      return { success: false, error: error.message };
    }
  }, [apiRequest, persistSession]);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      if (persistSession) {
        localStorage.removeItem('admin_token');
      }
      
      setAuthState({
        admin: null,
        isAuthenticated: false,
        isLoading: false,
        permissions: null,
        role: null,
        sessionId: null
      });
      
      toast.success('Logged out successfully');
    }
  }, [apiRequest, persistSession]);

  const refreshAuth = useCallback(async () => {
    if (!authState.isAuthenticated) return;

    try {
      const response = await apiRequest<APIResponse & { admin: IAdmin }>('/auth/me');
      
      if (response.success && response.admin) {
        setAuthState(prev => ({
          ...prev,
          admin: response.admin,
          permissions: response.admin.permissions,
          role: response.admin.role
        }));
      }
    } catch (error) {
      console.error('Auth refresh failed:', error);
      await logout();
    }
  }, [authState.isAuthenticated, apiRequest, logout]);

  // Admin management methods
  const fetchAdmins = useCallback(async (page = 1, limit = 20) => {
    try {
      setManagementState(prev => ({ ...prev, isLoading: true }));

      const response = await apiRequest<APIResponse & {
        admins: IAdmin[];
        total: number;
        page: number;
        totalPages: number;
      }>(`/admins?page=${page}&limit=${limit}`);

      if (response.success) {
        setManagementState(prev => ({
          ...prev,
          admins: response.admins,
          totalAdmins: response.total,
          currentPage: response.page,
          totalPages: response.totalPages,
          isLoading: false
        }));
      }
    } catch (error: any) {
      console.error('Fetch admins error:', error);
      setManagementState(prev => ({ ...prev, isLoading: false }));
      toast.error(error.message || 'Failed to fetch admins');
    }
  }, [apiRequest]);

  const createAdmin = useCallback(async (adminData: AdminCreateRequest) => {
    try {
      setManagementState(prev => ({ ...prev, isCreating: true }));

      const response = await apiRequest<APIResponse & { admin: IAdmin }>('/admins', {
        method: 'POST',
        body: JSON.stringify(adminData)
      });

      if (response.success && response.admin) {
        setManagementState(prev => ({
          ...prev,
          admins: [...prev.admins, response.admin],
          totalAdmins: prev.totalAdmins + 1,
          isCreating: false
        }));
        
        toast.success('Admin created successfully');
        return { success: true, admin: response.admin };
      }
    } catch (error: any) {
      console.error('Create admin error:', error);
      setManagementState(prev => ({ ...prev, isCreating: false }));
      toast.error(error.message || 'Failed to create admin');
      return { success: false, error: error.message };
    }
  }, [apiRequest]);

  const updateAdmin = useCallback(async (adminId: string, updateData: AdminUpdateRequest) => {
    try {
      setManagementState(prev => ({ ...prev, isUpdating: true }));

      const response = await apiRequest<APIResponse & { admin: IAdmin }>(`/admins/${adminId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData)
      });

      if (response.success && response.admin) {
        setManagementState(prev => ({
          ...prev,
          admins: prev.admins.map(admin => 
            admin._id === adminId ? response.admin : admin
          ),
          isUpdating: false
        }));
        
        toast.success('Admin updated successfully');
        return { success: true, admin: response.admin };
      }
    } catch (error: any) {
      console.error('Update admin error:', error);
      setManagementState(prev => ({ ...prev, isUpdating: false }));
      toast.error(error.message || 'Failed to update admin');
      return { success: false, error: error.message };
    }
  }, [apiRequest]);

  const deleteAdmin = useCallback(async (adminId: string) => {
    try {
      setManagementState(prev => ({ ...prev, isDeleting: true }));

      const response = await apiRequest<APIResponse>(`/admins/${adminId}`, {
        method: 'DELETE'
      });

      if (response.success) {
        setManagementState(prev => ({
          ...prev,
          admins: prev.admins.filter(admin => admin._id !== adminId),
          totalAdmins: prev.totalAdmins - 1,
          isDeleting: false
        }));
        
        toast.success('Admin deleted successfully');
        return { success: true };
      }
    } catch (error: any) {
      console.error('Delete admin error:', error);
      setManagementState(prev => ({ ...prev, isDeleting: false }));
      toast.error(error.message || 'Failed to delete admin');
      return { success: false, error: error.message };
    }
  }, [apiRequest]);

  // Analytics methods
  const fetchAnalytics = useCallback(async () => {
    try {
      setAnalyticsState(prev => ({ ...prev, isLoading: true }));

      const [userStats, messageStats, groupStats, systemStats] = await Promise.all([
        apiRequest<any>('/analytics/users'),
        apiRequest<any>('/analytics/messages'),
        apiRequest<any>('/analytics/groups'),
        apiRequest<any>('/analytics/system')
      ]);

      setAnalyticsState({
        userStats: userStats.data,
        messageStats: messageStats.data,
        groupStats: groupStats.data,
        systemStats: systemStats.data,
        isLoading: false
      });
    } catch (error: any) {
      console.error('Fetch analytics error:', error);
      setAnalyticsState(prev => ({ ...prev, isLoading: false }));
      toast.error(error.message || 'Failed to fetch analytics');
    }
  }, [apiRequest]);

  // Permission helpers
  const hasPermission = useCallback((resource: keyof AdminPermissions, action: 'read' | 'write' | 'delete') => {
    if (!authState.permissions) return false;
    return authState.permissions[resource]?.[action] || false;
  }, [authState.permissions]);

  const hasRole = useCallback((role: AdminRole) => {
    return authState.role === role;
  }, [authState.role]);

  const isSuperAdmin = useCallback(() => {
    return authState.role === 'super_admin';
  }, [authState.role]);

  // Auto-refresh effect
  useEffect(() => {
    if (!autoRefresh || !authState.isAuthenticated) return;

    const interval = setInterval(() => {
      refreshAuth();
      if (hasPermission('analytics', 'read')) {
        fetchAnalytics();
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, authState.isAuthenticated, refreshInterval, refreshAuth, fetchAnalytics, hasPermission]);

  // User management methods
  const suspendUser = useCallback(async (userId: string, reason?: string) => {
    try {
      const response = await apiRequest<APIResponse>(`/users/${userId}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });

      if (response.success) {
        toast.success('User suspended successfully');
        return { success: true };
      }
    } catch (error: any) {
      console.error('Suspend user error:', error);
      toast.error(error.message || 'Failed to suspend user');
      return { success: false, error: error.message };
    }
  }, [apiRequest]);

  const unsuspendUser = useCallback(async (userId: string) => {
    try {
      const response = await apiRequest<APIResponse>(`/users/${userId}/unsuspend`, {
        method: 'POST'
      });

      if (response.success) {
        toast.success('User unsuspended successfully');
        return { success: true };
      }
    } catch (error: any) {
      console.error('Unsuspend user error:', error);
      toast.error(error.message || 'Failed to unsuspend user');
      return { success: false, error: error.message };
    }
  }, [apiRequest]);

  const deleteMessage = useCallback(async (messageId: string, reason?: string) => {
    try {
      const response = await apiRequest<APIResponse>(`/messages/${messageId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason })
      });

      if (response.success) {
        toast.success('Message deleted successfully');
        return { success: true };
      }
    } catch (error: any) {
      console.error('Delete message error:', error);
      toast.error(error.message || 'Failed to delete message');
      return { success: false, error: error.message };
    }
  }, [apiRequest]);

  const sendBroadcast = useCallback(async (message: string, targetUsers?: string[]) => {
    try {
      const response = await apiRequest<APIResponse>('/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          message,
          targetUsers
        })
      });

      if (response.success) {
        toast.success('Broadcast sent successfully');
        return { success: true };
      }
    } catch (error: any) {
      console.error('Send broadcast error:', error);
      toast.error(error.message || 'Failed to send broadcast');
      return { success: false, error: error.message };
    }
  }, [apiRequest]);

  return {
    // Authentication state
    ...authState,
    
    // Management state
    management: managementState,
    
    // Analytics state
    analytics: analyticsState,
    
    // Authentication methods
    login,
    logout,
    refreshAuth,
    
    // Admin management methods
    fetchAdmins,
    createAdmin,
    updateAdmin,
    deleteAdmin,
    
    // Analytics methods
    fetchAnalytics,
    
    // Permission helpers
    hasPermission,
    hasRole,
    isSuperAdmin,
    
    // User management methods
    suspendUser,
    unsuspendUser,
    deleteMessage,
    sendBroadcast,
    
    // Utility methods
    apiRequest
  };
}