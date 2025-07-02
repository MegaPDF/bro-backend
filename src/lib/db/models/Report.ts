import mongoose, { Schema, Document } from 'mongoose';

export interface IReport extends Document {
  _id: string;
  reporterId: mongoose.Types.ObjectId;
  reportedUserId?: mongoose.Types.ObjectId;
  reportedMessageId?: mongoose.Types.ObjectId;
  reportedGroupId?: mongoose.Types.ObjectId;
  type: 'user' | 'message' | 'group' | 'status';
  category: 'spam' | 'harassment' | 'inappropriate_content' | 'violence' | 'hate_speech' | 'fake_news' | 'scam' | 'other';
  description: string;
  evidence: {
    screenshots: string[];
    additionalInfo: string;
  };
  status: 'pending' | 'investigating' | 'resolved' | 'dismissed' | 'escalated';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignedTo?: mongoose.Types.ObjectId;
  resolution?: {
    action: 'no_action' | 'warning' | 'content_removed' | 'user_suspended' | 'user_banned' | 'group_disabled';
    reason: string;
    resolvedBy: mongoose.Types.ObjectId;
    resolvedAt: Date;
  };
  adminNotes: {
    note: string;
    addedBy: mongoose.Types.ObjectId;
    addedAt: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const ReportSchema: Schema = new Schema({
  reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reportedUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  reportedMessageId: { type: Schema.Types.ObjectId, ref: 'Message' },
  reportedGroupId: { type: Schema.Types.ObjectId, ref: 'Group' },
  type: { 
    type: String, 
    enum: ['user', 'message', 'group', 'status'],
    required: true 
  },
  category: { 
    type: String, 
    enum: ['spam', 'harassment', 'inappropriate_content', 'violence', 'hate_speech', 'fake_news', 'scam', 'other'],
    required: true 
  },
  description: { type: String, required: true },
  evidence: {
    screenshots: [{ type: String }],
    additionalInfo: { type: String }
  },
  status: { 
    type: String, 
    enum: ['pending', 'investigating', 'resolved', 'dismissed', 'escalated'],
    default: 'pending'
  },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'Admin' },
  resolution: {
    action: { 
      type: String, 
      enum: ['no_action', 'warning', 'content_removed', 'user_suspended', 'user_banned', 'group_disabled']
    },
    reason: { type: String },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    resolvedAt: { type: Date }
  },
  adminNotes: [{
    note: { type: String, required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
    addedAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

ReportSchema.index({ reporterId: 1 });
ReportSchema.index({ status: 1 });
ReportSchema.index({ priority: 1 });
ReportSchema.index({ type: 1 });
ReportSchema.index({ assignedTo: 1 });
ReportSchema.index({ createdAt: -1 });

export default mongoose.models.Report || mongoose.model<IReport>('Report', ReportSchema);
