import mongoose, { Schema, Document } from 'mongoose';

export interface IStatus extends Document {
  _id: string;
  userId: mongoose.Types.ObjectId;
  type: 'text' | 'image' | 'video';
  content?: string;
  mediaId?: mongoose.Types.ObjectId;
  backgroundColor?: string;
  textColor?: string;
  font?: string;
  privacy: {
    type: 'everyone' | 'contacts' | 'contacts_except' | 'only_share_with';
    excludedContacts?: mongoose.Types.ObjectId[];
    selectedContacts?: mongoose.Types.ObjectId[];
  };
  viewers: {
    userId: mongoose.Types.ObjectId;
    viewedAt: Date;
  }[];
  expiresAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StatusSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['text', 'image', 'video'], required: true },
  content: { type: String },
  mediaId: { type: Schema.Types.ObjectId, ref: 'Media' },
  backgroundColor: { type: String },
  textColor: { type: String },
  font: { type: String },
  privacy: {
    type: { 
      type: String, 
      enum: ['everyone', 'contacts', 'contacts_except', 'only_share_with'],
      default: 'contacts'
    },
    excludedContacts: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    selectedContacts: [{ type: Schema.Types.ObjectId, ref: 'User' }]
  },
  viewers: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    viewedAt: { type: Date, default: Date.now }
  }],
  expiresAt: { type: Date, required: true },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

StatusSchema.index({ userId: 1 });
StatusSchema.index({ expiresAt: 1 });
StatusSchema.index({ isActive: 1 });
StatusSchema.index({ 'viewers.userId': 1 });

export default mongoose.models.Status || mongoose.model<IStatus>('Status', StatusSchema);

