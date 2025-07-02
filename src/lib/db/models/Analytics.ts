
import mongoose, { Schema, Document } from 'mongoose';

export interface IAnalytics extends Document {
  _id: string;
  type: 'user_activity' | 'message_volume' | 'call_stats' | 'feature_usage' | 'error_tracking' | 'performance';
  date: Date;
  hourly?: number;
  daily?: number;
  weekly?: number;
  monthly?: number;
  data: {
    [key: string]: any;
  };
  dimensions: {
    userId?: mongoose.Types.ObjectId;
    chatId?: mongoose.Types.ObjectId;
    groupId?: mongoose.Types.ObjectId;
    region?: string;
    platform?: string;
    version?: string;
    feature?: string;
    [key: string]: any;
  };
  metrics: {
    count?: number;
    duration?: number;
    size?: number;
    success_rate?: number;
    error_rate?: number;
    [key: string]: any;
  };
  createdAt: Date;
  updatedAt: Date;
}

const AnalyticsSchema: Schema = new Schema({
  type: { 
    type: String, 
    enum: ['user_activity', 'message_volume', 'call_stats', 'feature_usage', 'error_tracking', 'performance'],
    required: true 
  },
  date: { type: Date, required: true },
  hourly: { type: Number },
  daily: { type: Number },
  weekly: { type: Number },
  monthly: { type: Number },
  data: { type: Schema.Types.Mixed, default: {} },
  dimensions: {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    chatId: { type: Schema.Types.ObjectId, ref: 'Chat' },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group' },
    region: { type: String },
    platform: { type: String },
    version: { type: String },
    feature: { type: String },
    additionalDimensions: { type: Schema.Types.Mixed }
  },
  metrics: {
    count: { type: Number },
    duration: { type: Number },
    size: { type: Number },
    success_rate: { type: Number },
    error_rate: { type: Number },
    additionalMetrics: { type: Schema.Types.Mixed }
  }
}, {
  timestamps: true
});

AnalyticsSchema.index({ type: 1, date: -1 });
AnalyticsSchema.index({ 'dimensions.userId': 1 });
AnalyticsSchema.index({ 'dimensions.region': 1 });
AnalyticsSchema.index({ 'dimensions.platform': 1 });
AnalyticsSchema.index({ date: -1 });

export default mongoose.models.Analytics || mongoose.model<IAnalytics>('Analytics', AnalyticsSchema);