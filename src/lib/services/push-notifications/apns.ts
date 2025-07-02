import apn from 'apn';
import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import User from '@/lib/db/models/User';
import Notification from '@/lib/db/models/Notification';
import { NOTIFICATION_TYPES } from '@/lib/utils/constants';
import { analyticsTracker } from '../analytics/tracker';
import type { INotification } from '@/lib/db/models/Notification';

export interface APNSConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  key: string; // Private key content
  production: boolean;
}

export interface APNSNotification {
  deviceTokens: string[];
  title: string;
  body: string;
  badge?: number;
  sound?: string;
  category?: string;
  threadId?: string;
  data?: Record<string, any>;
  priority?: 'high' | 'normal';
  expiry?: Date;
  collapseId?: string;
}

export interface APNSResult {
  success: boolean;
  successful: string[];
  failed: Array<{
    deviceToken: string;
    error: string;
    errorCode?: string;
  }>;
  totalSent: number;
  successCount: number;
  failureCount: number;
}

export class APNSService {
  private provider: apn.Provider | null = null;
  private config: APNSConfig | null = null;
  private isInitialized = false;

  constructor() {
    this.initialize();
  }

  // Initialize APNS provider
  private async initialize(): Promise<void> {
    try {
      const config = await this.getAPNSConfig();
      if (!config) {
        console.warn('APNS configuration not found');
        return;
      }

      this.config = config;
      
      const options: apn.ProviderOptions = {
        token: {
          key: config.key,
          keyId: config.keyId,
          teamId: config.teamId
        },
        production: config.production
      };

      this.provider = new apn.Provider(options);
      this.isInitialized = true;

      console.log('APNS service initialized successfully');

    } catch (error: any) {
      console.error('Failed to initialize APNS service:', error);
      this.isInitialized = false;
    }
  }

  // Send notification to iOS devices
  async sendNotification(notification: APNSNotification): Promise<APNSResult> {
    if (!this.isInitialized || !this.provider || !this.config) {
      return {
        success: false,
        successful: [],
        failed: notification.deviceTokens.map(token => ({
          deviceToken: token,
          error: 'APNS service not initialized'
        })),
        totalSent: 0,
        successCount: 0,
        failureCount: notification.deviceTokens.length
      };
    }

    try {
      const apnNotification = new apn.Notification();
      
      // Set notification properties
      apnNotification.alert = {
        title: notification.title,
        body: notification.body
      };

      if (notification.badge !== undefined) {
        apnNotification.badge = notification.badge;
      }

      if (notification.sound) {
        apnNotification.sound = notification.sound;
      }

      if (notification.category) {
        apnNotification.category = notification.category;
      }

      if (notification.threadId) {
        apnNotification.threadId = notification.threadId;
      }

      if (notification.data) {
        apnNotification.payload = notification.data;
      }

      // Set priority
      apnNotification.priority = notification.priority === 'high' ? 10 : 5;

      // Set expiry
      if (notification.expiry) {
        apnNotification.expiry = Math.floor(notification.expiry.getTime() / 1000);
      }

      // Set collapse ID
      if (notification.collapseId) {
        apnNotification.collapseId = notification.collapseId;
      }

      // Set bundle ID
      apnNotification.topic = this.config.bundleId;

      // Send to all device tokens
      const result = await this.provider.send(apnNotification, notification.deviceTokens);

      const successful: string[] = [];
      const failed: Array<{ deviceToken: string; error: string; errorCode?: string }> = [];

      // Process results
      result.sent.forEach(response => {
        successful.push(response.device);
      });

      result.failed.forEach(response => {
        failed.push({
          deviceToken: response.device,
          error: response.error?.message || 'Unknown error',
          errorCode: (response.error as any)?.code
        });
      });

      // Handle invalid tokens
      await this.handleInvalidTokens(result.failed);

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        'system',
        'push_notifications',
        'apns_send',
        {
          totalSent: result.sent.length,
          totalFailed: result.failed.length,
          success: result.sent.length > 0
        }
      );

      return {
        success: result.sent.length > 0,
        successful,
        failed,
        totalSent: notification.deviceTokens.length,
        successCount: result.sent.length,
        failureCount: result.failed.length
      };

    } catch (error: any) {
      console.error('APNS send error:', error);

      return {
        success: false,
        successful: [],
        failed: notification.deviceTokens.map(token => ({
          deviceToken: token,
          error: error.message
        })),
        totalSent: 0,
        successCount: 0,
        failureCount: notification.deviceTokens.length
      };
    }
  }

  // Send notification from database notification record
  async sendFromNotification(notificationId: string): Promise<APNSResult> {
    try {
      await connectDB();

      const notification = await Notification.findById(notificationId)
        .populate('userId')
        .lean();

      if (!notification) {
        throw new Error('Notification not found');
      }

      // Get iOS device tokens for the user
      const user = await User.findById(notification.userId).lean();
      if (!user) {
        throw new Error('User not found');
      }

      const iosTokens = user.devices
        .filter(device => device.platform === 'ios' && device.pushToken)
        .map(device => device.pushToken!);

      if (iosTokens.length === 0) {
        return {
          success: false,
          successful: [],
          failed: [],
          totalSent: 0,
          successCount: 0,
          failureCount: 0
        };
      }

      // Create APNS notification
      const apnsNotification: APNSNotification = {
        deviceTokens: iosTokens,
        title: notification.title,
        body: notification.body,
        badge: notification.badge,
        sound: notification.sound || 'default',
        data: notification.data,
        priority: notification.priority === 'high' ? 'high' : 'normal'
      };

      // Add category based on notification type
      if (notification.type === NOTIFICATION_TYPES.MESSAGE) {
        apnsNotification.category = 'MESSAGE_CATEGORY';
        apnsNotification.threadId = notification.data.chatId;
      } else if (notification.type === NOTIFICATION_TYPES.CALL) {
        apnsNotification.category = 'CALL_CATEGORY';
      }

      const result = await this.sendNotification(apnsNotification);

      // Update notification status
      await Notification.findByIdAndUpdate(notificationId, {
        isSent: result.success,
        sentAt: new Date(),
        deliveryStatus: result.success ? 'sent' : 'failed'
      });

      return result;

    } catch (error: any) {
      console.error('Error sending notification from database:', error);
      throw error;
    }
  }

  // Send message notification
  async sendMessageNotification(
    userId: string,
    chatId: string,
    senderName: string,
    messageContent: string,
    isGroup: boolean = false
  ): Promise<APNSResult> {
    try {
      await connectDB();

      const user = await User.findById(userId).lean();
      if (!user || !user.notificationSettings.messageNotifications) {
        return this.createEmptyResult();
      }

      const iosTokens = user.devices
        .filter(device => device.platform === 'ios' && device.pushToken)
        .map(device => device.pushToken!);

      if (iosTokens.length === 0) {
        return this.createEmptyResult();
      }

      const notification: APNSNotification = {
        deviceTokens: iosTokens,
        title: isGroup ? `${senderName} in Group` : senderName,
        body: messageContent,
        sound: user.notificationSettings.sound || 'default',
        category: 'MESSAGE_CATEGORY',
        threadId: chatId,
        data: {
          type: 'message',
          chatId,
          senderId: userId,
          isGroup
        },
        priority: 'high'
      };

      return await this.sendNotification(notification);

    } catch (error: any) {
      console.error('Error sending message notification:', error);
      return this.createEmptyResult();
    }
  }

  // Send call notification
  async sendCallNotification(
    userId: string,
    callId: string,
    callerName: string,
    callType: 'voice' | 'video',
    isGroup: boolean = false
  ): Promise<APNSResult> {
    try {
      await connectDB();

      const user = await User.findById(userId).lean();
      if (!user || !user.notificationSettings.callNotifications) {
        return this.createEmptyResult();
      }

      const iosTokens = user.de
        .filter(device => device.platform === 'ios' && device.pushToken)
        .map(device => device.pushToken!);

      if (iosTokens.length === 0) {
        return this.createEmptyResult();
      }

      const notification: APNSNotification = {
        deviceTokens: iosTokens,
        title: `Incoming ${callType} call`,
        body: `${callerName} is calling you${isGroup ? ' in a group' : ''}`,
        sound: 'call_ringtone.aiff',
        category: 'CALL_CATEGORY',
        data: {
          type: 'call',
          callId,
          callerId: userId,
          callType,
          isGroup
        },
        priority: 'high'
      };

      return await this.sendNotification(notification);

    } catch (error: any) {
      console.error('Error sending call notification:', error);
      return this.createEmptyResult();
    }
  }

  // Get APNS configuration from settings
  private async getAPNSConfig(): Promise<APNSConfig | null> {
    try {
      await connectDB();

      const [keyIdSetting, teamIdSetting, bundleIdSetting, keySetting, prodSetting] = await Promise.all([
        Settings.findOne({ category: 'push_notifications', key: 'apns_key_id' }),
        Settings.findOne({ category: 'push_notifications', key: 'apns_team_id' }),
        Settings.findOne({ category: 'push_notifications', key: 'apns_bundle_id' }),
        Settings.findOne({ category: 'push_notifications', key: 'apns_private_key' }),
        Settings.findOne({ category: 'push_notifications', key: 'apns_production' })
      ]);

      if (!keyIdSetting || !teamIdSetting || !bundleIdSetting || !keySetting) {
        return null;
      }

      return {
        keyId: keyIdSetting.value,
        teamId: teamIdSetting.value,
        bundleId: bundleIdSetting.value,
        key: keySetting.value,
        production: prodSetting?.value || false
      };

    } catch (error) {
      console.error('Error getting APNS config:', error);
      return null;
    }
  }

  // Handle invalid device tokens
  private async handleInvalidTokens(failedResponses: apn.Responses['failed']): Promise<void> {
    try {
      const invalidTokens: string[] = [];

      failedResponses.forEach(response => {
        if (response.error?.code === 'InvalidToken' || 
            response.error?.code === 'BadDeviceToken' ||
            response.error?.code === 'Unregistered') {
          invalidTokens.push(response.device);
        }
      });

      if (invalidTokens.length > 0) {
        await connectDB();

        // Remove invalid tokens from user devices
        await User.updateMany(
          { 'devices.pushToken': { $in: invalidTokens } },
          { $pull: { devices: { pushToken: { $in: invalidTokens } } } }
        );

        console.log(`Removed ${invalidTokens.length} invalid APNS tokens`);
      }

    } catch (error) {
      console.error('Error handling invalid tokens:', error);
    }
  }

  // Create empty result
  private createEmptyResult(): APNSResult {
    return {
      success: false,
      successful: [],
      failed: [],
      totalSent: 0,
      successCount: 0,
      failureCount: 0
    };
  }

  // Clean up resources
  async cleanup(): Promise<void> {
    if (this.provider) {
      await this.provider.shutdown();
      this.provider = null;
      this.isInitialized = false;
    }
  }

  // Check if service is ready
  isReady(): boolean {
    return this.isInitialized && !!this.provider;
  }
}

// Export singleton instance
export const apnsService = new APNSService();