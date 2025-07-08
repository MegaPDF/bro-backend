// ===================================================================
// ADMIN API ROUTES IMPLEMENTATION
// ===================================================================

// src/app/api/admin/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import Admin from '@/lib/db/models/Admin';
import { withAdminAuth } from '@/lib/auth/middleware';
import { adminCreateSchema, adminSearchSchema } from '@/lib/validations/admin';
import { ValidationHelpers } from '@/lib/utils/helpers';
import { ERROR_CODES } from '@/lib/utils/constants';
import { analyticsTracker } from '@/lib/services/analytics/tracker';
import bcrypt from 'bcryptjs';
import type { AdminAuthenticatedRequest } from '@/lib/auth/middleware';
import type { APIResponse, ListResponse } from '@/types/api';
import type { IAdmin, AdminCreateRequest, AdminListResponse } from '@/types/admin';

// GET /api/admin - List all admins with search/filter
export const GET = withAdminAuth(async (request: AdminAuthenticatedRequest) => {
  try {
    await connectDB();

    const url = new URL(request.url);
    const searchParams = Object.fromEntries(url.searchParams.entries());
    
    // Validate search parameters
    const validation = ValidationHelpers.validate(adminSearchSchema, searchParams);
    if (!validation.success) {
      return NextResponse.json({
        success: false,
        error: 'Invalid search parameters',
        details: validation.errors,
        code: ERROR_CODES.VALIDATION_ERROR,
        timestamp: new Date()
      } as APIResponse, { status: 400 });
    }

    const { 
      q, 
      role, 
      isActive, 
      createdBy, 
      lastLoginFrom, 
      lastLoginTo,
      page, 
      limit, 
      sort, 
      order 
    } = validation.data;

    // Build query
    const query: any = {};
    
    if (q) {
      query.$or = [
        { username: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { fullName: new RegExp(q, 'i') }
      ];
    }

    if (role) query.role = role;
    if (typeof isActive === 'boolean') query.isActive = isActive;
    if (createdBy) query.createdBy = createdBy;
    
    if (lastLoginFrom || lastLoginTo) {
      query.lastLogin = {};
      if (lastLoginFrom) query.lastLogin.$gte = lastLoginFrom;
      if (lastLoginTo) query.lastLogin.$lte = lastLoginTo;
    }

    // Execute query with pagination
    const skip = (page - 1) * limit;
    const sortOrder = order === 'asc' ? 1 : -1;

    const [admins, total] = await Promise.all([
      Admin.find(query)
        .select('-password -twoFactorSecret')
        .sort({ [sort]: sortOrder })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'username fullName')
        .lean(),
      Admin.countDocuments(query)
    ]);

    // Track analytics
    await analyticsTracker.trackUserActivity(
      request.tokenPayload.adminId,
      'admin_list_viewed',
      { 
        searchQuery: q,
        resultsCount: admins.length,
        filters: { role, isActive, createdBy }
      }
    );

    const response: AdminListResponse = {
      admins: admins.map(admin => ({ admin: admin as any })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPrevPage: page > 1
    };

    return NextResponse.json({
      success: true,
      data: response,
      timestamp: new Date()
    } as APIResponse<AdminListResponse>);

  } catch (error: any) {
    console.error('Error listing admins:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch admins',
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      timestamp: new Date()
    } as APIResponse, { status: 500 });
  }
}, { requiredPermissions: ['users.read'] });

// POST /api/admin - Create new admin
export const POST = withAdminAuth(async (request: AdminAuthenticatedRequest) => {
  try {
    await connectDB();

    const body = await request.json();
    
    // Validate request body
    const validation = ValidationHelpers.validate(adminCreateSchema, body);
    if (!validation.success) {
      return NextResponse.json({
        success: false,
        error: 'Invalid admin data',
        details: validation.errors,
        code: ERROR_CODES.VALIDATION_ERROR,
        timestamp: new Date()
      } as APIResponse, { status: 400 });
    }

    const adminData = validation.data as AdminCreateRequest;

    // Check if username or email already exists
    const existingAdmin = await Admin.findOne({
      $or: [
        { username: adminData.username },
        { email: adminData.email }
      ]
    });

    if (existingAdmin) {
      return NextResponse.json({
        success: false,
        error: existingAdmin.username === adminData.username 
          ? 'Username already exists'
          : 'Email already exists',
        code: ERROR_CODES.CONFLICT,
        timestamp: new Date()
      } as APIResponse, { status: 409 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(adminData.password, 12);

    // Set default permissions based on role
    const defaultPermissions = getDefaultPermissions(adminData.role);
    const permissions = { ...defaultPermissions, ...adminData.permissions };

    // Create admin
    const newAdmin = new Admin({
      username: adminData.username,
      email: adminData.email,
      password: hashedPassword,
      fullName: adminData.fullName,
      role: adminData.role,
      permissions,
      createdBy: request.tokenPayload.adminId,
      isActive: true
    });

    await newAdmin.save();

    // Track analytics
    await analyticsTracker.trackUserActivity(
      request.tokenPayload.adminId,
      'admin_created',
      { 
        newAdminId: newAdmin._id.toString(),
        role: adminData.role
      }
    );

    // Return created admin (without sensitive data)
    const adminResponse = await Admin.findById(newAdmin._id)
      .select('-password -twoFactorSecret')
      .populate('createdBy', 'username fullName')
      .lean();

    return NextResponse.json({
      success: true,
      data: { admin: adminResponse },
      message: 'Admin created successfully',
      timestamp: new Date()
    } as APIResponse, { status: 201 });

  } catch (error: any) {
    console.error('Error creating admin:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to create admin',
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      timestamp: new Date()
    } as APIResponse, { status: 500 });
  }
}, { requiredPermissions: ['users.write'] });

// Helper function to get default permissions based on role
function getDefaultPermissions(role: string) {
  const basePermissions = {
    users: { read: true, write: false, delete: false },
    messages: { read: true, write: false, delete: false },
    groups: { read: true, write: false, delete: false },
    reports: { read: true, write: true, delete: false },
    analytics: { read: true, write: false, delete: false },
    settings: { read: false, write: false, delete: false },
    broadcasts: { read: true, write: false, delete: false }
  };

  switch (role) {
    case 'super_admin':
      return {
        users: { read: true, write: true, delete: true },
        messages: { read: true, write: true, delete: true },
        groups: { read: true, write: true, delete: true },
        reports: { read: true, write: true, delete: true },
        analytics: { read: true, write: true, delete: true },
        settings: { read: true, write: true, delete: true },
        broadcasts: { read: true, write: true, delete: true }
      };
    case 'admin':
      return {
        ...basePermissions,
        users: { read: true, write: true, delete: false },
        messages: { read: true, write: true, delete: true },
        groups: { read: true, write: true, delete: false },
        settings: { read: true, write: false, delete: false },
        broadcasts: { read: true, write: true, delete: false }
      };
    case 'moderator':
      return {
        ...basePermissions,
        messages: { read: true, write: true, delete: true },
        groups: { read: true, write: true, delete: false }
      };
    default:
      return basePermissions;
  }
}