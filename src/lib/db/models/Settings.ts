
import mongoose, { Schema, Document } from 'mongoose';

export interface ISettings extends Document {
  _id: string;
  category: 'aws' | 'email' | 'coturn' | 'push_notifications' | 'general' | 'security' | 'features';
  key: string;
  value: any;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  isEncrypted: boolean;
  isPublic: boolean; // Can be accessed by non-admin APIs
  updatedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SettingsSchema: Schema = new Schema({
  category: { 
    type: String, 
    enum: ['aws', 'email', 'coturn', 'push_notifications', 'general', 'security', 'features'],
    required: true 
  },
  key: { type: String, required: true },
  value: { type: Schema.Types.Mixed, required: true },
  type: { 
    type: String, 
    enum: ['string', 'number', 'boolean', 'object', 'array'],
    required: true 
  },
  description: { type: String, required: true },
  isEncrypted: { type: Boolean, default: false },
  isPublic: { type: Boolean, default: false },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin', required: true }
}, {
  timestamps: true
});

SettingsSchema.index({ category: 1 });
SettingsSchema.index({ key: 1 });
SettingsSchema.index({ category: 1, key: 1 }, { unique: true });
SettingsSchema.index({ isPublic: 1 });

export default mongoose.models.Settings || mongoose.model<ISettings>('Settings', SettingsSchema);
