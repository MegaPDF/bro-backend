import mongoose, { Schema, Document } from 'mongoose';

export interface IChat extends Document {
  _id: string;
  type: 'individual' | 'group';
  participants: mongoose.Types.ObjectId[];
  groupInfo?: {
    name: string;
    description: string;
    avatar: string;
    admins: mongoose.Types.ObjectId[];
    creator: mongoose.Types.ObjectId;
    inviteLink: string;
    settings: {
      onlyAdminsCanMessage: boolean;
      onlyAdminsCanEditGroupInfo: boolean;
      approvalRequired: boolean;
    };
  };
  lastMessage?: mongoose.Types.ObjectId;
  lastMessageTime: Date;
  unreadCount: {
    userId: mongoose.Types.ObjectId;
    count: number;
  }[];
  isPinned: {
    userId: mongoose.Types.ObjectId;
    pinnedAt: Date;
  }[];
  isArchived: {
    userId: mongoose.Types.ObjectId;
    archivedAt: Date;
  }[];
  isMuted: {
    userId: mongoose.Types.ObjectId;
    mutedUntil: Date;
  }[];
  disappearingMessages: {
    enabled: boolean;
    duration: number; // in seconds
    enabledBy: mongoose.Types.ObjectId;
    enabledAt: Date;
  };
  encryptionKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const ChatSchema: Schema = new Schema({
  type: { type: String, enum: ['individual', 'group'], required: true },
  participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
  groupInfo: {
    name: { type: String },
    description: { type: String },
    avatar: { type: String },
    admins: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    creator: { type: Schema.Types.ObjectId, ref: 'User' },
    inviteLink: { type: String },
    settings: {
      onlyAdminsCanMessage: { type: Boolean, default: false },
      onlyAdminsCanEditGroupInfo: { type: Boolean, default: false },
      approvalRequired: { type: Boolean, default: false }
    }
  },
  lastMessage: { type: Schema.Types.ObjectId, ref: 'Message' },
  lastMessageTime: { type: Date, default: Date.now },
  unreadCount: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    count: { type: Number, default: 0 }
  }],
  isPinned: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    pinnedAt: { type: Date, default: Date.now }
  }],
  isArchived: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    archivedAt: { type: Date, default: Date.now }
  }],
  isMuted: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    mutedUntil: { type: Date }
  }],
  disappearingMessages: {
    enabled: { type: Boolean, default: false },
    duration: { type: Number, default: 0 },
    enabledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    enabledAt: { type: Date }
  },
  encryptionKey: { type: String, required: true }
}, {
  timestamps: true
});

ChatSchema.index({ participants: 1 });
ChatSchema.index({ type: 1 });
ChatSchema.index({ lastMessageTime: -1 });
ChatSchema.index({ 'groupInfo.inviteLink': 1 });

export default mongoose.models.Chat || mongoose.model<IChat>('Chat', ChatSchema);
