import admin from 'firebase-admin';
import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import User from '@/lib/db/models/User';
import Notification from '@/lib/db/models/Notification';
import { NOTIFICATION_TYPES } from '@/lib/utils/constants';
import { analyticsTracker } from '../analytics/tracker';
import type { INotification } from '@/lib/db/models/Notification';

export interface FCMConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  serverKey: string;
}

export interface FCMNotification {
  deviceTokens: string[];
  title: string;
  body: string;
  icon?: string;
  image?: string;
  sound?: string;
  badge?: string;
  tag?: string;
  color?: string;
  clickAction?: string;
  data?: Record<string, string>;
  priority?: 'high' | 'normal';
  timeToLive?: number;
  collapseKey?: string;
  restrictedPackageName?: string;
}

export interface FCMResult {
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
  multicastId?: string;
}

export interface FCMTopicNotification {
  topic: string;
  condition?: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  priority?: 'high' | 'normal';
}

export class FCMService {
  private app: admin.app.App | null = null;
  private messaging: admin.messaging.Messaging | null = null;
  private isInitialized = false;

  constructor() {
    this.initialize();
  }

  // Initialize FCM
  private async initialize(): Promise<void> {
    try {
      const config = await this.getFCMConfig();
      if (!config) {
        console.warn('FCM configuration not found');
        return;
      }

      // Initialize Firebase Admin SDK
      if (admin.apps.length === 0) {
        this.app = admin.initializeApp({
          credential: admin.credential.cert({
            projectId: config.projectId,
            clientEmail: config.clientEmail,
            privateKey: config.privateKey.replace(/\\n/g, '\n')
          })
        });
      } else {
        this.app = admin.apps[0] as admin.app.App;
      }

      this.messaging = admin.messaging(this.app);
      this.isInitialized = true;

      console.log('FCM service initialized successfully');

    } catch (error: any) {
      console.error('Failed to initialize FCM service:', error);
      this.isInitialized = false;
    }
  }

  // Send notification to Android/Web devices
  async sendNotification(notification: FCMNotification): Promise<FCMResult> {
    if (!this.isInitialized || !this.messaging) {
      return {
        success: false,
        successful: [],
        failed: notification.deviceTokens.map(token => ({
          deviceToken: token,
          error: 'FCM service not initialized'
        })),
        totalSent: 0,
        successCount: 0,
        failureCount: notification.deviceTokens.length
      };
    }

    try {
      const message: admin.messaging.MulticastMessage = {
        tokens: notification.deviceTokens,
        notification: {
          title: notification.title,
          body: notification.body,
          imageUrl: notification.image
        },
        data: notification.data || {},
        android: {
          priority: notification.priority,
          ttl: notification.timeToLive ? notification.timeToLive * 1000 : undefined,
          collapseKey: notification.collapseKey,
          restrictedPackageName: notification.restrictedPackageName,
          notification: {
            title: notification.title,
            body: notification.body,
            icon: notification.icon,
            color: notification.color,
            sound: notification.sound || 'default',
            tag: notification.tag,
            clickAction: notification.clickAction,
            imageUrl: notification.image
          }
        },
        webpush: {
          notification: {
            title: notification.title,
            body: notification.body,
            icon: notification.icon,
            image: notification.image,
            badge: notification.badge,
            tag: notification.tag,
            sound: notification.sound,
            data: notification.data
          },
          fcmOptions: {
            link: notification.clickAction
          }
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.body
              },
              sound: notification.sound || 'default'
            }
          }
        }
      };

      const response = await this.messaging.sendMulticast(message);

      const successful: string[] = [];
      const failed: Array<{ deviceToken: string; error: string; errorCode?: string }> = [];

      // Process results
      response.responses.forEach((result, index) => {
        const token = notification.deviceTokens[index];
        
        if (result.success) {
          successful.push(token);
        } else {
          failed.push({
            deviceToken: token,
            error: result.error?.message || 'Unknown error',
            errorCode: result.error?.code
          });
        }
      });

      // Handle invalid tokens
      await this.handleInvalidTokens(response.responses, notification.deviceTokens);

      // Track analytics
      await analyticsTracker.trackFeatureUsage(
        'system',
        'push_notifications',
        'fcm_send',
        {
          totalSent: response.successCount,
          totalFailed: response.failureCount,
          success: response.successCount > 0
        }
      );

      return {
        success: response.successCount > 0,
        successful,
        failed,
        totalSent: notification.deviceTokens.length,
        successCount: response.successCount,
        failureCount: response.failureCount,
        multicastId: response.multicastId
      };

    } catch (error: any) {
      console.error('FCM send error:', error);

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

  // Send to topic
  async sendToTopic(notification: FCMTopicNotification): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.isInitialized || !this.messaging) {
      return {
        success: false,
        error: 'FCM service not initialized'
      };
    }

    try {
      const message: admin.messaging.Message = {
        topic: notification.topic,
        notification: {
          title: notification.title,
          body: notification.body
        },
        data: notification.data || {},
        android: {
          priority: notification.priority || 'normal'
        }
      };

      const messageId = await this.messaging.send(message);

      return {
        success: true,
        messageId
      };

    } catch (error: any) {
      console.error('FCM topic send error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Send notification from database notification record
  async sendFromNotification(notificationId: string): Promise<FCMResult> {
    try {
      await connectDB();

      const notification = await Notification.findById(notificationId)
        .populate('userId')
        .lean();

      if (!notification) {
        throw new Error('Notification not found');
      }

      // Get Android/Web device tokens for the user
      const user = await User.findById(notification.userId).lean();
      if (!user) {
        throw new Error('User not found');
      }

      const fcmTokens = UserSchema
        .filter(device => 
          (device.platform === 'android' || device.platform === 'web') && 
          device.pushToken
        )
        .map(device => device.pushToken!);

      if (fcmTokens.length === 0) {
        return this.createEmptyResult();
      }

      // Create FCM notification
      const fcmNotification: FCMNotification = {
        deviceTokens: fcmTokens,
        title: notification.title,
        body: notification.body,
        sound: notification.sound || 'default',
        data: this.convertDataToStrings(notification.data),
        priority: notification.priority === 'high' ? 'high' : 'normal',
        icon: '/icon-192x192.png',
        badge: '/badge-icon.png'
      };

      // Add specific properties based on notification type
      if (notification.type === NOTIFICATION_TYPES.MESSAGE) {
        fcmNotification.tag = `message_${notification.data.chatId}`;
        fcmNotification.clickAction = `/chat/${notification.data.chatId}`;
      } else if (notification.type === NOTIFICATION_TYPES.CALL) {
        fcmNotification.tag = `call_${notification.data.callId}`;
        fcmNotification.clickAction = `/call/${notification.data.callId}`;
      }

      const result = await this.sendNotification(fcmNotification);

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
  ): Promise<FCMResult> {
    try {
      await connectDB();

      const user = await User.findById(userId).lean();
      if (!user || !user.notificationSettings.messageNotifications) {
        return this.createEmptyResult();
      }

      const fcmTokens = user.devices
        .filter(device => 
          (device.platform === 'android' || device.platform === 'web') && 
          device.pushToken
        )
        .map(device => device.pushToken!);

      if (fcmTokens.length === 0) {
        return this.createEmptyResult();
      }

      const notification: FCMNotification = {
        deviceTokens: fcmTokens,
        title: isGroup ? `${senderName} in Group` : senderName,
        body: messageContent,
        sound: user.notificationSettings.sound || 'default',
        icon: '/icon-192x192.png',
        tag: `message_${chatId}`,
        clickAction: `/chat/${chatId}`,
        data: {
          type: 'message',
          chatId,
          senderId: userId,
          isGroup: isGroup.toString()
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
  ): Promise<FCMResult> {
    try {
      await connectDB();

      const user = await User.findById(userId).lean();
      if (!user || !user.notificationSettings.callNotifications) {
        return this.createEmptyResult();
      }

      const fcmTokens = user.devices
        .filter(device => 
          (device.platform === 'android' || device.platform === 'web') && 
          device.pushToken
        )
        .map(device => device.pushToken!);

      if (fcmTokens.length === 0) {
        return this.createEmptyResult();
      }

      const notification: FCMNotification = {
        deviceTokens: fcmTokens,
        title: `Incoming ${callType} call`,
        body: `${callerName} is calling you${isGroup ? ' in a group' : ''}`,
        sound: 'call_ringtone',
        icon: '/icon-192x192.png',
        tag: `call_${callId}`,
        clickAction: `/call/${callId}`,
        data: {
          type: 'call',
          callId,
          callerId: userId,
          callType,
          isGroup: isGroup.toString()
        },
        priority: 'high'
      };

      return await this.sendNotification(notification);

    } catch (error: any) {
      console.error('Error sending call notification:', error);
      return this.createEmptyResult();
    }
  }

  // Subscribe to topic
  async subscribeToTopic(deviceTokens: string[], topic: string): Promise<{ successCount: number; failureCount: number; errors: any[] }> {
    if (!this.isInitialized || !this.messaging) {
      throw new Error('FCM service not initialized');
    }

    try {
      const response = await this.messaging.subscribeToTopic(deviceTokens, topic);
      
      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        errors: response.errors
      };

    } catch (error: any) {
      console.error('FCM subscribe to topic error:', error);
      throw error;
    }
  }

  // Unsubscribe from topic
  async unsubscribeFromTopic(deviceTokens: string[], topic: string): Promise<{ successCount: number; failureCount: number; errors: any[] }> {
    if (!this.isInitialized || !this.messaging) {
      throw new Error('FCM service not initialized');
    }

    try {
      const response = await this.messaging.unsubscribeFromTopic(deviceTokens, topic);
      
      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        errors: response.errors
      };

    } catch (error: any) {
      console.error('FCM unsubscribe from topic error:', error);
      throw error;
    }
  }

  // Get FCM configuration from settings
  private async getFCMConfig(): Promise<FCMConfig | null> {
    try {
      await connectDB();

      const [projectIdSetting, clientEmailSetting, privateKeySetting, serverKeySetting] = await Promise.all([
        Settings.findOne({ category: 'push_notifications', key: 'fcm_project_id' }),
        Settings.findOne({ category: 'push_notifications', key: 'fcm_client_email' }),
        Settings.findOne({ category: 'push_notifications', key: 'fcm_private_key' }),
        Settings.findOne({ category: 'push_notifications', key: 'fcm_server_key' })
      ]);

      if (!projectIdSetting || !clientEmailSetting || !privateKeySetting || !serverKeySetting) {
        return null;
      }

      return {
        projectId: projectIdSetting.value,
        clientEmail: clientEmailSetting.value,
        privateKey: privateKeySetting.value,
        serverKey: serverKeySetting.value
      };

    } catch (error) {
      console.error('Error getting FCM config:', error);
      return null;
    }
  }

  // Handle invalid device tokens
  private async handleInvalidTokens(
    responses: admin.messaging.SendResponse[],
    deviceTokens: string[]
  ): Promise<void> {
    try {
      const invalidTokens: string[] = [];

      responses.forEach((response, index) => {
        if (response.error) {
          const errorCode = response.error.code;
          if (errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered') {
            invalidTokens.push(deviceTokens[index]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        await connectDB();

        // Remove invalid tokens from user devices
        await User.updateMany(
          { 'devices.pushToken': { $in: invalidTokens } },
          { $pull: { devices: { pushToken: { $in: invalidTokens } } } }
        );

        console.log(`Removed ${invalidTokens.length} invalid FCM tokens`);
      }

    } catch (error) {
      console.error('Error handling invalid tokens:', error);
    }
  }

  // Convert data object to string values (FCM requirement)
  private convertDataToStrings(data: Record<string, any>): Record<string, string> {
    const result: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined) {
        result[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }
    
    return result;
  }

  // Create empty result
  private createEmptyResult(): FCMResult {
    return {
      success: false,
      successful: [],
      failed: [],
      totalSent: 0,
      successCount: 0,
      failureCount: 0
    };
  }

  // Check if service is ready
  isReady(): boolean {
    return this.isInitialized && !!this.messaging;
  }
}

// Export singleton instance
export const fcmService = new FCMService();