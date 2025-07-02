import apn from 'apn';
import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import User from '@/lib/db/models/User';
import Notification from '@/lib/db/models/Notification';
import { analyticsTracker } from '../analytics/tracker';
import type { IUser } from '@/lib/db/models/User';
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
  private isInitialized = false;

  constructor() {
    this.initializeAPNS();
  }

  // Initialize APNS
  private async initializeAPNS(): Promise<void> {
    try {
      const config = await this.getAPNSConfig();
      
      if (!config) {
        console.warn('APNS configuration not found in settings');
        return;
      }

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
      console.error('APNS initialization error:', error);
      this.isInitialized = false;
    }
  }

  // Send notification
  async sendNotification(notification: APNSNotification): Promise<APNSResult> {
    if (!this.isInitialized || !this.provider) {
      throw new Error('APNS service not initialized');
    }

    try {
      const apnNotification = new apn.Notification();
      
      // Set notification properties
      apnNotification.alert = {
        title: notification.title,
        body: notification.body
      };
      
      apnNotification.sound = notification.sound || 'default';
      if (notification.badge !== undefined) {
        apnNotification.badge = notification.badge;
      }
      if (notification.threadId) {
        apnNotification.threadId = notification.threadId;
      }
      apnNotification.priority = notification.priority === 'high' ? 10 : 5;
      if (notification.collapseId !== undefined) {
        apnNotification.collapseId = notification.collapseId;
      }
      
      if (notification.expiry) {
        apnNotification.expiry = Math.floor(notification.expiry.getTime() / 1000);
      }

      // Set custom data
      if (notification.data) {
        apnNotification.payload = { ...apnNotification.payload, ...notification.data };
      }

      // Send to all device tokens
      const response = await this.provider.send(apnNotification, notification.deviceTokens);

      const successful: string[] = [];
      const failed: Array<{ deviceToken: string; error: string; errorCode?: string }> = [];

      // Process successful sends
      response.sent.forEach(({ device }) => {
        successful.push(device);
      });

      // Process failed sends
      response.failed.forEach(({ device, error }) => {
        failed.push({
          deviceToken: device,
          error: error?.message || 'Unknown error',
          errorCode: (error && typeof (error as any).code !== 'undefined') ? (error as any).code : undefined
        });
      });

      // Handle invalid tokens
      await this.handleInvalidTokens(response.failed);

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        'system',
        'push_notifications',
        'apns_send',
        {
          totalSent: successful.length,
          totalFailed: failed.length,
          success: successful.length > 0
        }
      );

      return {
        success: successful.length > 0,
        successful,
        failed,
        totalSent: notification.deviceTokens.length,
        successCount: successful.length,
        failureCount: failed.length
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
  async sendNotificationFromDB(notificationId: string): Promise<APNSResult> {
    try {
      await connectDB();

      const notificationDoc = await Notification.findById(notificationId).lean() as INotification | null;
      if (!notificationDoc) {
        throw new Error('Notification not found');
      }

      // Get iOS platform delivery info
      const iosPlatform = notificationDoc.platformDelivery?.find(
        (platform: any) => platform.platform === 'ios'
      );

      if (!iosPlatform || !iosPlatform.deviceTokens || iosPlatform.deviceTokens.length === 0) {
        return this.createEmptyResult();
      }

      const notification: APNSNotification = {
        deviceTokens: iosPlatform.deviceTokens,
        title: notificationDoc.title,
        body: notificationDoc.body,
        sound: notificationDoc.ios?.sound || notificationDoc.sound || 'default',
        badge: notificationDoc.ios?.badge || notificationDoc.badge,
        category: notificationDoc.ios?.category,
        threadId: notificationDoc.ios?.threadId,
        data: notificationDoc.data,
        priority: notificationDoc.priority === 'critical' || notificationDoc.priority === 'high' ? 'high' : 'normal'
      };

      const result = await this.sendNotification(notification);

      // Update notification status
      await Notification.findByIdAndUpdate(notificationId, {
        'platformDelivery.$.status': result.success ? 'sent' : 'failed',
        'platformDelivery.$.sentAt': new Date(),
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

      const user = await User.findById(userId).lean() as IUser | null;
      if (!user || !user.notificationSettings?.messageNotifications) {
        return this.createEmptyResult();
      }

      // Get iOS device tokens
      const iosTokens: string[] = [];
      if (user.devices && Array.isArray(user.devices)) {
        user.devices.forEach(device => {
          if (device.platform === 'ios' && device.pushToken) {
            iosTokens.push(device.pushToken);
          }
        });
      }

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

      const user = await User.findById(userId).lean() as IUser | null;
      if (!user || !user.notificationSettings?.callNotifications) {
        return this.createEmptyResult();
      }

      // Get iOS device tokens
      const iosTokens: string[] = [];
      if (user.devices && Array.isArray(user.devices)) {
        user.devices.forEach(device => {
          if (device.platform === 'ios' && device.pushToken) {
            iosTokens.push(device.pushToken);
          }
        });
      }

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
        production: prodSetting?.value === true || prodSetting?.value === 'true'
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
        const errorCode = (response.error && typeof (response.error as any).code !== 'undefined')
          ? (response.error as any).code
          : undefined;
        if (errorCode === 'InvalidToken' || 
            errorCode === 'BadDeviceToken' ||
            errorCode === 'Unregistered') {
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