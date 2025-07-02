import mongoose, { Schema, Document } from 'mongoose';

export interface IGroup extends Document {
  _id: string;
  chatId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  avatar: string;
  creator: mongoose.Types.ObjectId;
  admins: mongoose.Types.ObjectId[];
  members: {
    userId: mongoose.Types.ObjectId;
    role: 'member' | 'admin';
    joinedAt: Date;
    addedBy: mongoose.Types.ObjectId;
  }[];
  inviteLink: string;
  inviteCode: string;
  settings: {
    onlyAdminsCanMessage: boolean;
    onlyAdminsCanEditGroupInfo: boolean;
    onlyAdminsCanAddMembers: boolean;
    approvalRequired: boolean;
    disappearingMessages: {
      enabled: boolean;
      duration: number;
    };
  };
  memberCount: number;
  maxMembers: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const GroupSchema: Schema = new Schema({
  chatId: { type: Schema.Types.ObjectId, ref: 'Chat', required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  avatar: { type: String },
  creator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  admins: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  members: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['member', 'admin'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  }],
  inviteLink: { type: String, unique: true },
  inviteCode: { type: String, unique: true },
  settings: {
    onlyAdminsCanMessage: { type: Boolean, default: false },
    onlyAdminsCanEditGroupInfo: { type: Boolean, default: false },
    onlyAdminsCanAddMembers: { type: Boolean, default: false },
    approvalRequired: { type: Boolean, default: false },
    disappearingMessages: {
      enabled: { type: Boolean, default: false },
      duration: { type: Number, default: 0 }
    }
  },
  memberCount: { type: Number, default: 0 },
  maxMembers: { type: Number, default: 256 },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

GroupSchema.index({ chatId: 1 });
GroupSchema.index({ inviteLink: 1 });
GroupSchema.index({ inviteCode: 1 });
GroupSchema.index({ 'members.userId': 1 });
GroupSchema.index({ creator: 1 });

export default mongoose.models.Group || mongoose.model<IGroup>('Group', GroupSchema);
