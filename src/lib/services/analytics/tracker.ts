import { connectDB } from '@/lib/db/connection';
import Analytics, { IAnalytics } from '@/lib/db/models/Analytics';
import User from '@/lib/db/models/User';
import Message from '@/lib/db/models/Message';
import Call from '@/lib/db/models/Call';
import { DateHelpers, ObjectHelpers } from '@/lib/utils/helpers';
import { TIME_CONSTANTS } from '@/lib/utils/constants';
import mongoose from 'mongoose';
export interface TrackingEvent {
  type: 'user_activity' | 'message_volume' | 'call_stats' | 'feature_usage' | 'error_tracking' | 'performance';
  userId?: string;
  chatId?: string;
  groupId?: string;
  data: Record<string, any>;
  dimensions?: Record<string, any>;
  metrics?: Record<string, any>;
  timestamp?: Date;
}

export interface AnalyticsQuery {
  type?: string;
  startDate: Date;
  endDate: Date;
  granularity: 'hour' | 'day' | 'week' | 'month';
  userId?: string;
  groupBy?: string[];
  filters?: Record<string, any>;
}

export interface AnalyticsResult {
  data: Array<{
    timestamp: Date;
    metrics: Record<string, number>;
    dimensions?: Record<string, string>;
  }>;
  summary: {
    total: Record<string, number>;
    average: Record<string, number>;
    change: Record<string, number>;
  };
  metadata: {
    totalRecords: number;
    dateRange: { start: Date; end: Date };
    granularity: string;
  };
}

export class AnalyticsTracker {
  private static instance: AnalyticsTracker;
  private batchEvents: TrackingEvent[] = [];
  private batchSize = 100;
  private flushInterval = 30000; // 30 seconds
  private isFlushingBatch = false;
private isValidObjectId(id: string): boolean {
  // Check if the string is a valid MongoDB ObjectId format
  // Must be 24 character hex string
  return mongoose.Types.ObjectId.isValid(id) && (id.length === 24);
}
  constructor() {
    // Auto-flush events periodically
    setInterval(() => {
      this.flushEvents();
    }, this.flushInterval);
  }

  static getInstance(): AnalyticsTracker {
    if (!AnalyticsTracker.instance) {
      AnalyticsTracker.instance = new AnalyticsTracker();
    }
    return AnalyticsTracker.instance;
  }

  // Track individual event
  async track(event: TrackingEvent): Promise<void> {
    try {
      const enrichedEvent: TrackingEvent = {
        ...event,
        timestamp: event.timestamp || new Date(),
        dimensions: {
          ...event.dimensions,
          platform: 'web', // Default platform
          version: process.env.npm_package_version || '1.0.0'
        }
      };

      // Add to batch
      this.batchEvents.push(enrichedEvent);

      // Flush if batch is full
      if (this.batchEvents.length >= this.batchSize) {
        await this.flushEvents();
      }
    } catch (error) {
      console.error('Error tracking event:', error);
    }
  }

  // Track user activity
  async trackUserActivity(userId: string, activity: string, metadata?: Record<string, any>): Promise<void> {
    await this.track({
      type: 'user_activity',
      userId,
      data: {
        activity,
        ...metadata
      },
      metrics: {
        count: 1,
        duration: metadata?.duration || 0
      },
      dimensions: {
        activity,
        platform: metadata?.platform || 'web'
      }
    });
  }

  // Track message sent
  async trackMessage(senderId: string, chatId: string, messageType: string, metadata?: Record<string, any>): Promise<void> {
    await this.track({
      type: 'message_volume',
      userId: senderId,
      chatId,
      data: {
        messageType,
        isGroup: metadata?.isGroup || false,
        hasMedia: metadata?.hasMedia || false,
        ...metadata
      },
      metrics: {
        count: 1,
        size: metadata?.size || 0
      },
      dimensions: {
        messageType,
        chatType: metadata?.isGroup ? 'group' : 'individual',
        hasMedia: metadata?.hasMedia ? 'yes' : 'no'
      }
    });
  }

  // Track call
  async trackCall(callerId: string, callType: string, duration: number, participants: number, metadata?: Record<string, any>): Promise<void> {
    await this.track({
      type: 'call_stats',
      userId: callerId,
      data: {
        callType,
        participants,
        duration,
        quality: metadata?.quality || 'medium',
        endReason: metadata?.endReason || 'completed',
        ...metadata
      },
      metrics: {
        count: 1,
        duration,
        participants,
        success_rate: metadata?.endReason === 'completed' ? 1 : 0
      },
      dimensions: {
        callType,
        participants: participants.toString(),
        quality: metadata?.quality || 'medium',
        endReason: metadata?.endReason || 'completed'
      }
    });
  }

  // Track feature usage
  async trackFeatureUsage(userId: string, feature: string, action: string, metadata?: Record<string, any>): Promise<void> {
    await this.track({
      type: 'feature_usage',
      userId,
      data: {
        feature,
        action,
        ...metadata
      },
      metrics: {
        count: 1,
        success_rate: metadata?.success ? 1 : 0
      },
      dimensions: {
        feature,
        action,
        success: metadata?.success ? 'yes' : 'no'
      }
    });
  }

  // Track error
  async trackError(error: Error, userId?: string, context?: Record<string, any>): Promise<void> {
    await this.track({
      type: 'error_tracking',
      userId,
      data: {
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack,
        context: context || {},
        timestamp: new Date()
      },
      metrics: {
        count: 1,
        error_rate: 1
      },
      dimensions: {
        errorType: error.name,
        severity: context?.severity || 'error',
        component: context?.component || 'unknown'
      }
    });
  }

  // Track performance metrics
  async trackPerformance(metric: string, value: number, userId?: string, metadata?: Record<string, any>): Promise<void> {
    await this.track({
      type: 'performance',
      userId,
      data: {
        metric,
        value,
        ...metadata
      },
      metrics: {
        [metric]: value,
        count: 1
      },
      dimensions: {
        metric,
        component: metadata?.component || 'unknown'
      }
    });
  }

  // Flush events to database
  private async flushEvents(): Promise<void> {
    if (this.isFlushingBatch || this.batchEvents.length === 0) {
      return;
    }

    this.isFlushingBatch = true;

    try {
      await connectDB();

      const eventsToFlush = [...this.batchEvents];
      this.batchEvents = [];

      // Group events by hour for aggregation
      const aggregatedEvents = this.aggregateEvents(eventsToFlush);

      // Save aggregated events to database
      const bulkOps = aggregatedEvents.map(event => ({
        updateOne: {
          filter: {
            type: event.type,
            date: event.date,
            'dimensions.userId': event.dimensions?.userId,
            'dimensions.chatId': event.dimensions?.chatId,
            'dimensions.groupId': event.dimensions?.groupId
          },
          update: {
            $inc: event.metrics,
            $set: {
              type: event.type,
              date: event.date,
              data: event.data,
              dimensions: event.dimensions
            },
            $setOnInsert: {
              createdAt: new Date(),
              updatedAt: new Date()
            }
          },
          upsert: true
        }
      }));

      if (bulkOps.length > 0) {
        await Analytics.bulkWrite(bulkOps);
      }

    } catch (error) {
      console.error('Error flushing analytics events:', error);
      // Re-add events to batch for retry
      this.batchEvents.unshift(...this.batchEvents);
    } finally {
      this.isFlushingBatch = false;
    }
  }

  // Aggregate events by time period
 private aggregateEvents(events: TrackingEvent[]): Partial<IAnalytics>[] {
  const aggregated = new Map<string, Partial<IAnalytics>>();

  events.forEach(event => {
    const hourKey = this.getHourKey(event.timestamp || new Date());
    const key = `${event.type}_${hourKey}_${event.userId || 'anonymous'}_${event.chatId || ''}_${event.groupId || ''}`;

    if (!aggregated.has(key)) {
      aggregated.set(key, {
        type: event.type as any,
        date: new Date(hourKey),
        data: event.data,
        dimensions: {
          // Only convert to ObjectId if it's a valid ObjectId format
          userId: event.userId && this.isValidObjectId(event.userId) 
            ? new mongoose.Types.ObjectId(event.userId) 
            : undefined,
          chatId: event.chatId && this.isValidObjectId(event.chatId) 
            ? new mongoose.Types.ObjectId(event.chatId) 
            : undefined,
          groupId: event.groupId && this.isValidObjectId(event.groupId) 
            ? new mongoose.Types.ObjectId(event.groupId) 
            : undefined,
          // Store non-ObjectId user identifiers as strings
          userType: event.userId && !this.isValidObjectId(event.userId) 
            ? event.userId 
            : undefined,
          ...event.dimensions
        },
        metrics: {}
      });
    }

    const existing = aggregated.get(key)!;
    
    // Aggregate metrics
    if (event.metrics) {
      Object.keys(event.metrics).forEach(metric => {
        existing.metrics![metric] = (existing.metrics![metric] || 0) + event.metrics![metric];
      });
    }

    // Merge data
    existing.data = { ...existing.data, ...event.data };
  });

  return Array.from(aggregated.values());
}

  // Get hour key for aggregation
  private getHourKey(date: Date): string {
    const hour = new Date(date);
    hour.setMinutes(0, 0, 0);
    return hour.toISOString();
  }

  // Get real-time metrics
  async getRealTimeMetrics(): Promise<{
    activeUsers: number;
    messagesPerMinute: number;
    callsInProgress: number;
    errorRate: number;
  }> {
    try {
      await connectDB();

      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - TIME_CONSTANTS.MINUTE);
      const fiveMinutesAgo = new Date(now.getTime() - 5 * TIME_CONSTANTS.MINUTE);

      // Active users in last 5 minutes
      const activeUsers = await User.countDocuments({
        lastSeen: { $gte: fiveMinutesAgo }
      });

      // Messages in last minute
      const recentMessages = await Analytics.aggregate([
        {
          $match: {
            type: 'message_volume',
            date: { $gte: oneMinuteAgo }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$metrics.count' }
          }
        }
      ]);

      // Calls in progress
      const callsInProgress = await Call.countDocuments({
        status: { $in: ['initiated', 'ringing', 'connected'] }
      });

      // Error rate in last 5 minutes
      const [totalEvents, errorEvents] = await Promise.all([
        Analytics.aggregate([
          {
            $match: {
              date: { $gte: fiveMinutesAgo }
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$metrics.count' }
            }
          }
        ]),
        Analytics.aggregate([
          {
            $match: {
              type: 'error_tracking',
              date: { $gte: fiveMinutesAgo }
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$metrics.count' }
            }
          }
        ])
      ]);

      const totalCount = totalEvents[0]?.total || 1;
      const errorCount = errorEvents[0]?.total || 0;

      return {
        activeUsers,
        messagesPerMinute: recentMessages[0]?.total || 0,
        callsInProgress,
        errorRate: errorCount / totalCount
      };

    } catch (error) {
      console.error('Error getting real-time metrics:', error);
      return {
        activeUsers: 0,
        messagesPerMinute: 0,
        callsInProgress: 0,
        errorRate: 0
      };
    }
  }

  // Cleanup old analytics data
  async cleanupOldData(retentionDays: number = 90): Promise<void> {
    try {
      await connectDB();

      const cutoffDate = new Date(Date.now() - retentionDays * TIME_CONSTANTS.DAY);

      const result = await Analytics.deleteMany({
        date: { $lt: cutoffDate }
      });

      console.log(`Cleaned up ${result.deletedCount} old analytics records`);
    } catch (error) {
      console.error('Error cleaning up analytics data:', error);
    }
  }
}

// Singleton instance
export const analyticsTracker = AnalyticsTracker.getInstance();
