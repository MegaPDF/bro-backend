import mongoose, { Schema, Document } from 'mongoose';

export interface ICall extends Document {
  _id: string;
  type: 'voice' | 'video';
  callType: 'individual' | 'group';
  callerId: mongoose.Types.ObjectId;
  participants: {
    userId: mongoose.Types.ObjectId;
    status: 'calling' | 'ringing' | 'connected' | 'declined' | 'missed' | 'busy' | 'ended';
    joinedAt?: Date;
    leftAt?: Date;
    duration?: number; // in seconds
  }[];
  chatId?: mongoose.Types.ObjectId;
  groupId?: mongoose.Types.ObjectId;
  status: 'initiated' | 'ringing' | 'connected' | 'ended' | 'failed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  duration: number; // in seconds
  quality: {
    video: 'low' | 'medium' | 'high';
    audio: 'low' | 'medium' | 'high';
  };
  recording?: {
    enabled: boolean;
    url?: string;
    duration?: number;
    size?: number;
  };
  coturnServer: {
    region: string;
    server: string;
    username: string;
    credential: string;
  };
  webrtcData: {
    offer?: string;
    answer?: string;
    iceCandidates: string[];
  };
  endReason: 'completed' | 'declined' | 'missed' | 'failed' | 'cancelled' | 'busy';
  createdAt: Date;
  updatedAt: Date;
}

const CallSchema: Schema = new Schema({
  type: { type: String, enum: ['voice', 'video'], required: true },
  callType: { type: String, enum: ['individual', 'group'], required: true },
  callerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  participants: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { 
      type: String, 
      enum: ['calling', 'ringing', 'connected', 'declined', 'missed', 'busy', 'ended'],
      default: 'calling'
    },
    joinedAt: { type: Date },
    leftAt: { type: Date },
    duration: { type: Number, default: 0 }
  }],
  chatId: { type: Schema.Types.ObjectId, ref: 'Chat' },
  groupId: { type: Schema.Types.ObjectId, ref: 'Group' },
  status: { 
    type: String, 
    enum: ['initiated', 'ringing', 'connected', 'ended', 'failed', 'cancelled'],
    default: 'initiated'
  },
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date },
  duration: { type: Number, default: 0 },
  quality: {
    video: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    audio: { type: String, enum: ['low', 'medium', 'high'], default: 'high' }
  },
  recording: {
    enabled: { type: Boolean, default: false },
    url: { type: String },
    duration: { type: Number },
    size: { type: Number }
  },
  coturnServer: {
    region: { type: String },
    server: { type: String },
    username: { type: String },
    credential: { type: String }
  },
  webrtcData: {
    offer: { type: String },
    answer: { type: String },
    iceCandidates: [{ type: String }]
  },
  endReason: { 
    type: String, 
    enum: ['completed', 'declined', 'missed', 'failed', 'cancelled', 'busy']
  }
}, {
  timestamps: true
});

CallSchema.index({ callerId: 1 });
CallSchema.index({ 'participants.userId': 1 });
CallSchema.index({ status: 1 });
CallSchema.index({ startTime: -1 });
CallSchema.index({ chatId: 1 });

export default mongoose.models.Call || mongoose.model<ICall>('Call', CallSchema);

