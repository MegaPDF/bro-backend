
import mongoose, { Schema, Document } from 'mongoose';

export interface IAdmin extends Document {
  _id: string;
  username: string;
  email: string;
  password: string;
  fullName: string;
  avatar?: string;
  role: 'super_admin' | 'admin' | 'moderator' | 'support';
  permissions: {
    users: { read: boolean; write: boolean; delete: boolean; };
    messages: { read: boolean; write: boolean; delete: boolean; };
    groups: { read: boolean; write: boolean; delete: boolean; };
    reports: { read: boolean; write: boolean; delete: boolean; };
    analytics: { read: boolean; write: boolean; delete: boolean; };
    settings: { read: boolean; write: boolean; delete: boolean; };
    broadcasts: { read: boolean; write: boolean; delete: boolean; };
  };
  isActive: boolean;
  lastLogin?: Date;
  lastLoginIP?: string;
  loginHistory: {
    ip: string;
    userAgent: string;
    loginAt: Date;
    success: boolean;
  }[];
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AdminSchema: Schema = new Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true },
  avatar: { type: String },
  role: { 
    type: String, 
    enum: ['super_admin', 'admin', 'moderator', 'support'],
    default: 'support'
  },
  permissions: {
    users: {
      read: { type: Boolean, default: true },
      write: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    messages: {
      read: { type: Boolean, default: true },
      write: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    groups: {
      read: { type: Boolean, default: true },
      write: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    reports: {
      read: { type: Boolean, default: true },
      write: { type: Boolean, default: true },
      delete: { type: Boolean, default: false }
    },
    analytics: {
      read: { type: Boolean, default: true },
      write: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    settings: {
      read: { type: Boolean, default: false },
      write: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    broadcasts: {
      read: { type: Boolean, default: true },
      write: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    }
  },
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date },
  lastLoginIP: { type: String },
  loginHistory: [{
    ip: { type: String, required: true },
    userAgent: { type: String, required: true },
    loginAt: { type: Date, default: Date.now },
    success: { type: Boolean, required: true }
  }],
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String },
  createdBy: { type: Schema.Types.ObjectId, ref: 'Admin' }
}, {
  timestamps: true
});

AdminSchema.index({ username: 1 });
AdminSchema.index({ email: 1 });
AdminSchema.index({ role: 1 });
AdminSchema.index({ isActive: 1 });

export default mongoose.models.Admin || mongoose.model<IAdmin>('Admin', AdminSchema);
