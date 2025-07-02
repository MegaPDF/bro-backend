import mongoose, { Schema, Document } from 'mongoose';

export interface IMedia extends Document {
  _id: string;
  uploadedBy: mongoose.Types.ObjectId;
  type: 'image' | 'video' | 'audio' | 'document' | 'voice';
  originalName: string;
  filename: string;
  mimeType: string;
  size: number;
  duration?: number; // for audio/video
  dimensions?: {
    width: number;
    height: number;
  };
  url: string;
  thumbnailUrl?: string;
  s3Key: string;
  s3Bucket: string;
  isEncrypted: boolean;
  encryptionKey?: string;
  checksum: string;
  isCompressed: boolean;
  compressionQuality?: number;
  metadata: {
    [key: string]: any;
  };
  usage: 'message' | 'status' | 'profile' | 'group' | 'call_recording';
  isDeleted: boolean;
  deletedAt?: Date;
  expiresAt?: Date;
  downloadCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const MediaSchema: Schema = new Schema({
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['image', 'video', 'audio', 'document', 'voice'],
    required: true 
  },
  originalName: { type: String, required: true },
  filename: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  duration: { type: Number },
  dimensions: {
    width: { type: Number },
    height: { type: Number }
  },
  url: { type: String, required: true },
  thumbnailUrl: { type: String },
  s3Key: { type: String, required: true },
  s3Bucket: { type: String, required: true },
  isEncrypted: { type: Boolean, default: false },
  encryptionKey: { type: String },
  checksum: { type: String, required: true },
  isCompressed: { type: Boolean, default: false },
  compressionQuality: { type: Number },
  metadata: { type: Schema.Types.Mixed, default: {} },
  usage: { 
    type: String, 
    enum: ['message', 'status', 'profile', 'group', 'call_recording'],
    required: true 
  },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date },
  expiresAt: { type: Date },
  downloadCount: { type: Number, default: 0 }
}, {
  timestamps: true
});

MediaSchema.index({ uploadedBy: 1 });
MediaSchema.index({ type: 1 });
MediaSchema.index({ usage: 1 });
MediaSchema.index({ isDeleted: 1 });
MediaSchema.index({ expiresAt: 1 });
MediaSchema.index({ s3Key: 1 });

export default mongoose.models.Media || mongoose.model<IMedia>('Media', MediaSchema);