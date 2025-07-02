import mongoose, { Schema, Document } from 'mongoose';

export interface IContact extends Document {
  _id: string;
  userId: mongoose.Types.ObjectId;
  contactUserId?: mongoose.Types.ObjectId;
  name: string;
  phoneNumber: string;
  email?: string;
  avatar?: string;
  isRegistered: boolean;
  isBlocked: boolean;
  isFavorite: boolean;
  addedAt: Date;
  lastContactedAt?: Date;
  source: 'phone_contacts' | 'manual_add' | 'qr_code' | 'group' | 'broadcast';
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  contactUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  email: { type: String },
  avatar: { type: String },
  isRegistered: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false },
  isFavorite: { type: Boolean, default: false },
  addedAt: { type: Date, default: Date.now },
  lastContactedAt: { type: Date },
  source: { 
    type: String, 
    enum: ['phone_contacts', 'manual_add', 'qr_code', 'group', 'broadcast'],
    default: 'phone_contacts'
  }
}, {
  timestamps: true
});

ContactSchema.index({ userId: 1 });
ContactSchema.index({ contactUserId: 1 });
ContactSchema.index({ phoneNumber: 1 });
ContactSchema.index({ userId: 1, phoneNumber: 1 }, { unique: true });

export default mongoose.models.Contact || mongoose.model<IContact>('Contact', ContactSchema);

