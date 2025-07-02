import { connectDB } from '@/lib/db/connection';
import Analytics from '@/lib/db/models/Analytics';
import User from '@/lib/db/models/User';
import Message from '@/lib/db/models/Message';
import Call from '@/lib/db/models/Call';
import Group from '@/lib/db/models/Group';
import { DateHelpers } from '@/lib/utils/helpers';
import { TIME_CONSTANTS } from '@/lib/utils/constants';
import type { AnalyticsQuery, AnalyticsResult } from './tracker';

export interface DashboardMetrics {
  overview: {
    totalUsers: number;
    activeUsers: number;
    totalMessages: number;
    totalCalls: number;
    totalGroups: number;
    averageCallDuration: number;
    messageGrowthRate: number;
    userGrowthRate: number;
  };
  timeSeriesData: {
    userRegistrations: Array<{ date: string; count: number }>;
    messageVolume: Array<{ date: string; count: number; type?: string }>;
    callStats: Array<{ date: string; count: number; duration: number }>;
    activeUsers: Array<{ date: string; count: number }>;
  };
  topMetrics: {
    topGroups: Array<{ name: string; memberCount: number; messageCount: number }>;
    topUsers: Array<{ displayName: string; messageCount: number; callDuration: number }>;
    popularFeatures: Array<{ feature: string; usageCount: number; growthRate: number }>;
  };
  platformStats: {
    platforms: Array<{ platform: string; userCount: number; percentage: number }>;
    versions: Array<{ version: string; userCount: number; percentage: number }>;
  };
}

export interface UserAnalyticsReport {
  user: {
    id: string;
    displayName: string;
    phoneNumber: string;
    joinDate: Date;
    lastActive: Date;
  };
  activity: {
    messagesSent: number;
    messagesReceived: number;
    callsMade: number;
    callsReceived: number;
    totalCallDuration: number;
    groupsJoined: number;
    statusUpdates: number;
  };
  engagement: {
    dailyActivityHours: Array<{ hour: number; activity: number }>;
    weeklyActivity: Array<{ day: string; messages: number; calls: number }>;
    mostActiveChats: Array<{ chatName: string; messageCount: number }>;
    preferredFeatures: Array<{ feature: string; usageCount: number }>;
  };
  behavior: {
    averageSessionDuration: number;
    responseTime: number;
    mediaUsage: {
      images: number;
      videos: number;
      documents: number;
      voice: number;
    };
  };
}

export class ReportsService {
  // Generate dashboard metrics
  static async generateDashboardMetrics(period: 'today' | 'week' | 'month' | 'year' = 'month'): Promise<DashboardMetrics> {
    try {
      await connectDB();

      const { start, end } = DateHelpers.getDateRange(period);
      const previousPeriod = this.getPreviousPeriod(start, end);

      // Overview metrics
      const [
        totalUsers,
        activeUsers,
        totalMessages,
        totalCalls,
        totalGroups,
        previousUsers,
        previousMessages
      ] = await Promise.all([
        User.countDocuments({ status: 'active' }),
        User.countDocuments({ lastSeen: { $gte: start } }),
        Message.countDocuments({ createdAt: { $gte: start, $lte: end } }),
        Call.countDocuments({ startTime: { $gte: start, $lte: end } }),
        Group.countDocuments({ isActive: true }),
        User.countDocuments({ createdAt: { $gte: previousPeriod.start, $lte: previousPeriod.end } }),
        Message.countDocuments({ createdAt: { $gte: previousPeriod.start, $lte: previousPeriod.end } })
      ]);

      // Average call duration
      const callDurationResult = await Call.aggregate([
        { $match: { startTime: { $gte: start, $lte: end }, status: 'ended' } },
        { $group: { _id: null, avgDuration: { $avg: '$duration' } } }
      ]);

      const averageCallDuration = callDurationResult[0]?.avgDuration || 0;

      // Growth rates
      const userGrowthRate = previousUsers > 0 ? ((totalUsers - previousUsers) / previousUsers) * 100 : 0;
      const messageGrowthRate = previousMessages > 0 ? ((totalMessages - previousMessages) / previousMessages) * 100 : 0;

      // Time series data
      const timeSeriesData = await this.generateTimeSeriesData(start, end, period);

      // Top metrics
      const topMetrics = await this.generateTopMetrics(start, end);

      // Platform stats
      const platformStats = await this.generatePlatformStats();

      return {
        overview: {
          totalUsers,
          activeUsers,
          totalMessages,
          totalCalls,
          totalGroups,
          averageCallDuration,
          messageGrowthRate,
          userGrowthRate
        },
        timeSeriesData,
        topMetrics,
        platformStats
      };

    } catch (error) {
      console.error('Error generating dashboard metrics:', error);
      throw new Error('Failed to generate dashboard metrics');
    }
  }

  // Generate user analytics report
  static async generateUserReport(userId: string, period: 'week' | 'month' | 'year' = 'month'): Promise<UserAnalyticsReport> {
    try {
      await connectDB();

      const { start, end } = DateHelpers.getDateRange(period);

      // Get user details
      const user = await User.findById(userId).lean() as { _id: any; displayName: string; phoneNumber: string; createdAt: Date; lastSeen: Date } | null;
      if (!user) {
        throw new Error('User not found');
      }

      // Activity metrics
      const [messagesSent, messagesReceived, callsMade, callsReceived] = await Promise.all([
        Message.countDocuments({ senderId: userId, createdAt: { $gte: start, $lte: end } }),
        Message.countDocuments({ 
          chatId: { $in: await this.getUserChatIds(userId) },
          senderId: { $ne: userId },
          createdAt: { $gte: start, $lte: end }
        }),
        Call.countDocuments({ callerId: userId, startTime: { $gte: start, $lte: end } }),
        Call.countDocuments({ 
          'participants.userId': userId,
          callerId: { $ne: userId },
          startTime: { $gte: start, $lte: end }
        })
      ]);

      // Call duration
      const callDurationResult = await Call.aggregate([
        {
          $match: {
            $or: [
              { callerId: userId },
              { 'participants.userId': userId }
            ],
            startTime: { $gte: start, $lte: end },
            status: 'ended'
          }
        },
        { $group: { _id: null, totalDuration: { $sum: '$duration' } } }
      ]);

      const totalCallDuration = callDurationResult[0]?.totalDuration || 0;

      // Groups and status
      const [groupsJoined, statusUpdates] = await Promise.all([
        Group.countDocuments({ 'members.userId': userId, createdAt: { $gte: start, $lte: end } }),
        Analytics.countDocuments({ 
          type: 'feature_usage',
          'dimensions.userId': userId,
          'dimensions.feature': 'status',
          date: { $gte: start, $lte: end }
        })
      ]);

      // Engagement data
      const engagement = await this.generateUserEngagement(userId, start, end);

      // Behavior analysis
      const behavior = await this.generateUserBehavior(userId, start, end);

      return {
        user: {
          id: user._id.toString(),
          displayName: user.displayName,
          phoneNumber: user.phoneNumber,
          joinDate: user.createdAt,
          lastActive: user.lastSeen
        },
        activity: {
          messagesSent,
          messagesReceived,
          callsMade,
          callsReceived,
          totalCallDuration,
          groupsJoined,
          statusUpdates
        },
        engagement,
        behavior
      };

    } catch (error) {
      console.error('Error generating user report:', error);
      throw new Error('Failed to generate user report');
    }
  }

  // Generate custom analytics query
  static async queryAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult> {
    try {
      await connectDB();

      const { startDate, endDate, granularity, type, userId, groupBy, filters } = query;

      // Build match stage
      const matchStage: any = {
        date: { $gte: startDate, $lte: endDate }
      };

      if (type) {
        matchStage.type = type;
      }

      if (userId) {
        matchStage['dimensions.userId'] = userId;
      }

      if (filters) {
        Object.keys(filters).forEach(key => {
          matchStage[`dimensions.${key}`] = filters[key];
        });
      }

      // Build group stage based on granularity
      const groupStage = this.buildGroupStage(granularity, groupBy);

      // Execute aggregation
      const pipeline: import('mongoose').PipelineStage[] = [
        { $match: matchStage },
        { $group: groupStage },
        { $sort: { _id: 1 as 1 | -1 } }
      ];

      const results = await Analytics.aggregate(pipeline);

      // Process results
      const data = results.map(result => ({
        timestamp: this.parseGroupId(result._id, granularity),
        metrics: result.metrics,
        dimensions: result.dimensions
      }));

      // Calculate summary
      const summary = this.calculateSummary(data, startDate, endDate);

      return {
        data,
        summary,
        metadata: {
          totalRecords: results.length,
          dateRange: { start: startDate, end: endDate },
          granularity
        }
      };

    } catch (error) {
      console.error('Error querying analytics:', error);
      throw new Error('Failed to query analytics');
    }
  }

  // Generate export data for admin
  static async generateExportData(type: 'users' | 'messages' | 'calls' | 'analytics', filters?: Record<string, any>): Promise<any[]> {
    try {
      await connectDB();

      switch (type) {
        case 'users':
          return await this.exportUsers(filters);
        case 'messages':
          return await this.exportMessages(filters);
        case 'calls':
          return await this.exportCalls(filters);
        case 'analytics':
          return await this.exportAnalytics(filters);
        default:
          throw new Error('Invalid export type');
      }

    } catch (error) {
      console.error('Error generating export data:', error);
      throw new Error('Failed to generate export data');
    }
  }

  // Helper methods
  private static getPreviousPeriod(start: Date, end: Date): { start: Date; end: Date } {
    const duration = end.getTime() - start.getTime();
    return {
      start: new Date(start.getTime() - duration),
      end: new Date(start.getTime())
    };
  }

  private static async generateTimeSeriesData(start: Date, end: Date, period: string): Promise<any> {
    const granularity = period === 'today' ? 'hour' : 'day';
    
    const [userRegistrations, messageVolume, callStats, activeUsers] = await Promise.all([
      this.getTimeSeriesData('user_registrations', start, end, granularity),
      this.getTimeSeriesData('message_volume', start, end, granularity),
      this.getTimeSeriesData('call_stats', start, end, granularity),
      this.getTimeSeriesData('user_activity', start, end, granularity)
    ]);

    return {
      userRegistrations,
      messageVolume,
      callStats,
      activeUsers
    };
  }

  private static async getTimeSeriesData(type: string, start: Date, end: Date, granularity: string): Promise<any[]> {
    const groupStage = this.buildGroupStage(granularity);
    
    const results = await Analytics.aggregate([
      {
        $match: {
          type,
          date: { $gte: start, $lte: end }
        }
      },
      { $group: groupStage },
      { $sort: { _id: 1 } }
    ]);

    return results.map(result => ({
      date: this.parseGroupId(result._id, granularity).toISOString().split('T')[0],
      count: result.metrics.count || 0,
      duration: result.metrics.duration || 0
    }));
  }

  private static async generateTopMetrics(start: Date, end: Date): Promise<any> {
    // Implementation for top groups, users, and features
    const [topGroups, topUsers, popularFeatures] = await Promise.all([
      this.getTopGroups(start, end),
      this.getTopUsers(start, end),
      this.getPopularFeatures(start, end)
    ]);

    return {
      topGroups,
      topUsers,
      popularFeatures
    };
  }

  private static async generatePlatformStats(): Promise<any> {
    // Platform distribution
    const platformStats = await User.aggregate([
      {
        $unwind: '$devices'
      },
      {
        $group: {
          _id: '$devices.platform',
          count: { $sum: 1 }
        }
      }
    ]);

    const total = platformStats.reduce((sum, stat) => sum + stat.count, 0);

    return {
      platforms: platformStats.map(stat => ({
        platform: stat._id,
        userCount: stat.count,
        percentage: (stat.count / total) * 100
      })),
      versions: [] // Implementation for app versions
    };
  }

  private static buildGroupStage(granularity: string, groupBy?: string[]): any {
    let dateExpression;

    switch (granularity) {
      case 'hour':
        dateExpression = {
          year: { $year: '$date' },
          month: { $month: '$date' },
          day: { $dayOfMonth: '$date' },
          hour: { $hour: '$date' }
        };
        break;
      case 'day':
        dateExpression = {
          year: { $year: '$date' },
          month: { $month: '$date' },
          day: { $dayOfMonth: '$date' }
        };
        break;
      case 'week':
        dateExpression = {
          year: { $year: '$date' },
          week: { $week: '$date' }
        };
        break;
      case 'month':
        dateExpression = {
          year: { $year: '$date' },
          month: { $month: '$date' }
        };
        break;
      default:
        dateExpression = { $dateToString: { format: '%Y-%m-%d', date: '$date' } };
    }

    const groupStage: any = {
      _id: dateExpression,
      metrics: {
        count: { $sum: '$metrics.count' },
        duration: { $sum: '$metrics.duration' },
        size: { $sum: '$metrics.size' }
      }
    };

    if (groupBy) {
      groupBy.forEach(field => {
        groupStage.dimensions = groupStage.dimensions || {};
        groupStage.dimensions[field] = { $first: `$dimensions.${field}` };
      });
    }

    return groupStage;
  }

  private static parseGroupId(groupId: any, granularity: string): Date {
    if (typeof groupId === 'string') {
      return new Date(groupId);
    }

    switch (granularity) {
      case 'hour':
        return new Date(groupId.year, groupId.month - 1, groupId.day, groupId.hour);
      case 'day':
        return new Date(groupId.year, groupId.month - 1, groupId.day);
      case 'week':
        return new Date(groupId.year, 0, 1 + (groupId.week - 1) * 7);
      case 'month':
        return new Date(groupId.year, groupId.month - 1, 1);
      default:
        return new Date(groupId);
    }
  }

  private static calculateSummary(data: any[], startDate: Date, endDate: Date): any {
    // Implementation for calculating summary statistics
    return {
      total: {},
      average: {},
      change: {}
    };
  }

  // Additional helper methods for user engagement, behavior, export functions
  private static async getUserChatIds(userId: string): Promise<string[]> {
    // Implementation to get user's chat IDs
    return [];
  }

  private static async generateUserEngagement(userId: string, start: Date, end: Date): Promise<any> {
    // Implementation for user engagement metrics
    return {
      dailyActivityHours: [],
      weeklyActivity: [],
      mostActiveChats: [],
      preferredFeatures: []
    };
  }

  private static async generateUserBehavior(userId: string, start: Date, end: Date): Promise<any> {
    // Implementation for user behavior analysis
    return {
      averageSessionDuration: 0,
      responseTime: 0,
      mediaUsage: {
        images: 0,
        videos: 0,
        documents: 0,
        voice: 0
      }
    };
  }

  private static async getTopGroups(start: Date, end: Date): Promise<any[]> {
    // Implementation for top groups
    return [];
  }

  private static async getTopUsers(start: Date, end: Date): Promise<any[]> {
    // Implementation for top users
    return [];
  }

  private static async getPopularFeatures(start: Date, end: Date): Promise<any[]> {
    // Implementation for popular features
    return [];
  }

  private static async exportUsers(filters?: Record<string, any>): Promise<any[]> {
    // Implementation for exporting users
    return [];
  }

  private static async exportMessages(filters?: Record<string, any>): Promise<any[]> {
    // Implementation for exporting messages
    return [];
  }

  private static async exportCalls(filters?: Record<string, any>): Promise<any[]> {
    // Implementation for exporting calls
    return [];
  }

  private static async exportAnalytics(filters?: Record<string, any>): Promise<any[]> {
    // Implementation for exporting analytics
    return [];
  }
}
