import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  _id: string;
  userId: mongoose.Types.ObjectId;
  type: 'message' | 'call' | 'group_invite' | 'status_view' | 'system' | 'broadcast';
  title: string;
  body: string;
  data: {
    chatId?: mongoose.Types.ObjectId;
    messageId?: mongoose.Types.ObjectId;
    callId?: mongoose.Types.ObjectId;
    groupId?: mongoose.Types.ObjectId;
    statusId?: mongoose.Types.ObjectId;
    senderId?: mongoose.Types.ObjectId;
    action?: string;
    [key: string]: any;
  };
  isRead: boolean;
  readAt?: Date;
  isSent: boolean;
  sentAt?: Date;
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'failed';
  deviceTokens: string[];
  priority: 'low' | 'normal' | 'high';
  sound?: string;
  badge?: number;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['message', 'call', 'group_invite', 'status_view', 'system', 'broadcast'],
    required: true 
  },
  title: { type: String, required: true },
  body: { type: String, required: true },
  data: {
    chatId: { type: Schema.Types.ObjectId, ref: 'Chat' },
    messageId: { type: Schema.Types.ObjectId, ref: 'Message' },
    callId: { type: Schema.Types.ObjectId, ref: 'Call' },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group' },
    statusId: { type: Schema.Types.ObjectId, ref: 'Status' },
    senderId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String },
    additionalData: { type: Schema.Types.Mixed }
  },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
  isSent: { type: Boolean, default: false },
  sentAt: { type: Date },
  deliveryStatus: { 
    type: String, 
    enum: ['pending', 'sent', 'delivered', 'failed'],
    default: 'pending'
  },
  deviceTokens: [{ type: String }],
  priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
  sound: { type: String },
  badge: { type: Number }
}, {
  timestamps: true
});

NotificationSchema.index({ userId: 1 });
NotificationSchema.index({ type: 1 });
NotificationSchema.index({ isRead: 1 });
NotificationSchema.index({ deliveryStatus: 1 });
NotificationSchema.index({ createdAt: -1 });

export default mongoose.models.Notification || mongoose.model<INotification>('Notification', NotificationSchema);