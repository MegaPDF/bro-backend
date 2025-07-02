import admin from 'firebase-admin';
import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import User, { IUser } from '@/lib/db/models/User';
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
}

export interface FCMTopicNotification {
  topic: string;
  condition?: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  priority?: 'high' | 'normal';
}

// Extend the Messaging interface to include sendMulticast method
interface ExtendedMessaging extends admin.messaging.Messaging {
  sendMulticast(message: admin.messaging.MulticastMessage): Promise<admin.messaging.BatchResponse>;
}

export class FCMService {
  private app: admin.app.App | null = null;
  private messaging: ExtendedMessaging | null = null;
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

      // Cast to ExtendedMessaging to include sendMulticast
      this.messaging = admin.messaging(this.app) as ExtendedMessaging;
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
    throw new Error('FCM service not initialized');
  }

  try {
    // Convert data to string values (FCM requirement)
    const stringData = notification.data ? this.convertDataToStrings(notification.data) : undefined;

    const message: admin.messaging.MulticastMessage = {
      tokens: notification.deviceTokens,
      data: stringData,
      // ... rest of your message config
    };

    // Use type assertion to bypass TypeScript error
    const response = await (this.messaging as any).sendMulticast(message);

    const successful: string[] = [];
    const failed: Array<{ deviceToken: string; error: string; errorCode?: string }> = [];

    // Process results
    response.responses.forEach((result: any, index: number) => {
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
      failureCount: response.failureCount
      // Remove multicastId reference
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

// 4. Fix sendFromNotification method with proper typing
async sendFromNotification(notificationId: string): Promise<FCMResult> {
  try {
    await connectDB();

    // Type the notification query result
    const notification = await Notification.findById(notificationId)
      .populate('userId')
      .lean() as INotification | null;

    if (!notification) {
      throw new Error('Notification not found');
    }

    // Type the user query result  
    const user = await User.findById(notification.userId).lean() as IUser | null;
    if (!user) {
      throw new Error('User not found');
    }

    // Fix the devices access
    const fcmTokens = user.devices  // ← Changed from UserSchema to user.devices
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
    console.error('FCM send from notification error:', error);
    return this.createEmptyResult();
  }
}
  // Fallback method for individual sends
  private async sendIndividualNotifications(notification: FCMNotification): Promise<FCMResult> {
    if (!this.messaging) {
      throw new Error('FCM service not initialized');
    }

    const successful: string[] = [];
    const failed: Array<{ deviceToken: string; error: string; errorCode?: string }> = [];

    // Send to each token individually
    for (const token of notification.deviceTokens) {
      try {
        const message: admin.messaging.Message = {
          token: token,
          data: notification.data ? this.convertDataToStrings(notification.data) : undefined,
          android: {
            priority: notification.priority === 'high' ? 'high' : 'normal',
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

        await this.messaging.send(message);
        successful.push(token);

      } catch (error: any) {
        failed.push({
          deviceToken: token,
          error: error.message,
          errorCode: error.code
        });

        // Handle invalid tokens
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
          await this.removeInvalidToken(token);
        }
      }
    }

    // Track analytics
    await analyticsTracker.trackFeatureUsage(
      'system',
      'push_notifications',
      'fcm_send_individual',
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
        await this.removeInvalidTokens(invalidTokens);
      }

    } catch (error) {
      console.error('Error handling invalid tokens:', error);
    }
  }

  // Remove invalid tokens from database
  private async removeInvalidTokens(invalidTokens: string[]): Promise<void> {
    try {
      await connectDB();

      // Remove invalid tokens from user devices
      await User.updateMany(
        { 'devices.pushToken': { $in: invalidTokens } },
        { $pull: { devices: { pushToken: { $in: invalidTokens } } } }
      );

      console.log(`Removed ${invalidTokens.length} invalid FCM tokens`);

    } catch (error) {
      console.error('Error removing invalid tokens:', error);
    }
  }

  // Remove single invalid token
  private async removeInvalidToken(token: string): Promise<void> {
    try {
      await connectDB();

      await User.updateMany(
        { 'devices.pushToken': token },
        { $pull: { devices: { pushToken: token } } }
      );

      console.log(`Removed invalid FCM token: ${token}`);

    } catch (error) {
      console.error('Error removing invalid token:', error);
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