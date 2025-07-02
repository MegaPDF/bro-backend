export interface IAdmin {
  _id: string;
  username: string;
  email: string;
  password: string;
  fullName: string;
  avatar?: string;
  role: AdminRole;
  permissions: AdminPermissions;
  isActive: boolean;
  lastLogin?: Date;
  lastLoginIP?: string;
  loginHistory: AdminLoginHistory[];
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminPermissions {
  users: PermissionSet;
  messages: PermissionSet;
  groups: PermissionSet;
  reports: PermissionSet;
  analytics: PermissionSet;
  settings: PermissionSet;
  broadcasts: PermissionSet;
}

export interface PermissionSet {
  read: boolean;
  write: boolean;
  delete: boolean;
}

export interface AdminLoginHistory {
  ip: string;
  userAgent: string;
  loginAt: Date;
  success: boolean;
}

export type AdminRole = 'super_admin' | 'admin' | 'moderator' | 'support';

export interface AdminCreateRequest {
  username: string;
  email: string;
  password: string;
  fullName: string;
  role: AdminRole;
  permissions?: Partial<AdminPermissions>;
}

export interface AdminUpdateRequest {
  username?: string;
  email?: string;
  fullName?: string;
  avatar?: string;
  role?: AdminRole;
  permissions?: Partial<AdminPermissions>;
  isActive?: boolean;
}

export interface AdminLoginRequest {
  username: string;
  password: string;
  twoFactorCode?: string;
}

export interface AdminResponse {
  admin: Omit<IAdmin, 'password' | 'twoFactorSecret'>;
}

export interface AdminListResponse {
  admins: AdminResponse[];
  total: number;
  page: number;
  limit: number;
}
