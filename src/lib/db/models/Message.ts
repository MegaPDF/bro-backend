import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  _id: string;
  chatId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'voice' | 'location' | 'contact' | 'sticker' | 'gif';
  content: string;
  mediaId?: mongoose.Types.ObjectId;
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  contact?: {
    name: string;
    phoneNumber: string;
    avatar?: string;
  };
  replyTo?: mongoose.Types.ObjectId;
  isForwarded: boolean;
  forwardedFrom?: mongoose.Types.ObjectId;
  forwardedTimes: number;
  reactions: {
    userId: mongoose.Types.ObjectId;
    emoji: string;
    createdAt: Date;
  }[];
  mentions: mongoose.Types.ObjectId[];
  status: 'sent' | 'delivered' | 'read' | 'failed';
  readBy: {
    userId: mongoose.Types.ObjectId;
    readAt: Date;
  }[];
  deliveredTo: {
    userId: mongoose.Types.ObjectId;
    deliveredAt: Date;
  }[];
  isEdited: boolean;
  editedAt?: Date;
  editHistory: {
    content: string;
    editedAt: Date;
  }[];
  isDeleted: boolean;
  deletedAt?: Date;
  deletedFor: mongoose.Types.ObjectId[];
  isStarred: boolean;
  starredBy: mongoose.Types.ObjectId[];
  encryptedContent?: string;
  disappearsAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema: Schema = new Schema({
  chatId: { type: Schema.Types.ObjectId, ref: 'Chat', required: true },
  senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['text', 'image', 'video', 'audio', 'document', 'voice', 'location', 'contact', 'sticker', 'gif'],
    required: true 
  },
  content: { type: String, required: true },
  mediaId: { type: Schema.Types.ObjectId, ref: 'Media' },
  location: {
    latitude: { type: Number },
    longitude: { type: Number },
    address: { type: String }
  },
  contact: {
    name: { type: String },
    phoneNumber: { type: String },
    avatar: { type: String }
  },
  replyTo: { type: Schema.Types.ObjectId, ref: 'Message' },
  isForwarded: { type: Boolean, default: false },
  forwardedFrom: { type: Schema.Types.ObjectId, ref: 'User' },
  forwardedTimes: { type: Number, default: 0 },
  reactions: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    emoji: { type: String },
    createdAt: { type: Date, default: Date.now }
  }],
  mentions: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['sent', 'delivered', 'read', 'failed'], default: 'sent' },
  readBy: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    readAt: { type: Date, default: Date.now }
  }],
  deliveredTo: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    deliveredAt: { type: Date, default: Date.now }
  }],
  isEdited: { type: Boolean, default: false },
  editedAt: { type: Date },
  editHistory: [{
    content: { type: String },
    editedAt: { type: Date, default: Date.now }
  }],
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date },
  deletedFor: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  isStarred: { type: Boolean, default: false },
  starredBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  encryptedContent: { type: String },
  disappearsAt: { type: Date }
}, {
  timestamps: true
});

MessageSchema.index({ chatId: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1 });
MessageSchema.index({ status: 1 });
MessageSchema.index({ disappearsAt: 1 });
MessageSchema.index({ isDeleted: 1 });

export default mongoose.models.Message || mongoose.model<IMessage>('Message', MessageSchema);
