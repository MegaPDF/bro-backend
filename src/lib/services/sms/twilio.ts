// lib/services/sms/twilio-service.ts
import twilio from 'twilio';
import { analyticsTracker } from '../analytics/tracker';
import { APP_CONFIG } from '@/lib/utils/constants';

export interface SMSOptions {
  template?: string;
  variables?: Record<string, string>;
  priority?: 'high' | 'normal' | 'low';
  statusCallback?: string;
  validityPeriod?: number; // in seconds
}

export interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
  status?: string;
  retryable?: boolean;
}

export interface BulkSMSResult {
  successful: Array<{
    phoneNumber: string;
    messageId: string;
  }>;
  failed: Array<{
    phoneNumber: string;
    error: string;
  }>;
  total: number;
  successCount: number;
  failureCount: number;
}

export class TwilioSMSService {
  private static instance: TwilioSMSService;
  private client!: twilio.Twilio;
  private fromNumber!: string;
  private messagingServiceSid?: string;
  private isEnabled: boolean;

  private constructor() {
    this.isEnabled = process.env.TWILIO_ENABLED === 'true';
    
    if (!this.isEnabled) {
      console.log('Twilio SMS service is disabled');
      return;
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER!;
    this.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

    if (!accountSid || !authToken || !this.fromNumber) {
      throw new Error('Missing required Twilio environment variables');
    }

    this.client = twilio(accountSid, authToken);
    console.log('✅ Twilio SMS service initialized');
  }

  static getInstance(): TwilioSMSService {
    if (!TwilioSMSService.instance) {
      TwilioSMSService.instance = new TwilioSMSService();
    }
    return TwilioSMSService.instance;
  }

  // Check if Twilio is enabled and configured
  isConfigured(): boolean {
    return this.isEnabled;
  }

  // Send single SMS
  async sendSMS(
    to: string,
    message: string,
    options: SMSOptions = {}
  ): Promise<SMSResult> {
    if (!this.isEnabled) {
      return {
        success: false,
        error: 'Twilio SMS service is not enabled',
        retryable: false
      };
    }

    try {
      // Validate phone number format
      if (!this.isValidPhoneNumber(to)) {
        return {
          success: false,
          error: `Invalid phone number format: ${to}`,
          retryable: false
        };
      }

      // Process template variables if provided
      const processedMessage = this.processTemplate(message, options.variables || {});

      // Prepare SMS parameters
      const smsParams: any = {
        body: processedMessage,
        to: to
      };

      // Use messaging service SID if available (recommended for better delivery)
      if (this.messagingServiceSid) {
        smsParams.messagingServiceSid = this.messagingServiceSid;
      } else {
        smsParams.from = this.fromNumber;
      }

      // Add optional parameters
      if (options.statusCallback) {
        smsParams.statusCallback = options.statusCallback;
      }

      if (options.validityPeriod) {
        smsParams.validityPeriod = options.validityPeriod;
      }

      // Send SMS
      const sentMessage = await this.client.messages.create(smsParams);

      // Track successful send
      await analyticsTracker.trackFeatureUsage(
        'system',
        'sms',
        'sent',
        {
          to: this.maskPhoneNumber(to),
          messageId: sentMessage.sid,
          status: sentMessage.status,
          provider: 'twilio'
        }
      );

      console.log(`✅ SMS sent successfully to ${this.maskPhoneNumber(to)} - SID: ${sentMessage.sid}`);

      return {
        success: true,
        messageId: sentMessage.sid,
        status: sentMessage.status
      };

    } catch (error: any) {
      console.error('Twilio SMS error:', error);

      // Track SMS error
      await analyticsTracker.trackError(error, 'system', {
        component: 'twilio_sms',
        action: 'send_sms',
        to: this.maskPhoneNumber(to)
      });

      // Determine if error is retryable
      const isRetryable = this.isRetryableError(error);

      return {
        success: false,
        error: this.formatTwilioError(error),
        retryable: isRetryable
      };
    }
  }

  // Send bulk SMS
  async sendBulkSMS(
    recipients: Array<{ phoneNumber: string; message: string; variables?: Record<string, string> }>,
    options: SMSOptions = {}
  ): Promise<BulkSMSResult> {
    if (!this.isEnabled) {
      return {
        successful: [],
        failed: recipients.map(r => ({
          phoneNumber: r.phoneNumber,
          error: 'Twilio SMS service is not enabled'
        })),
        total: recipients.length,
        successCount: 0,
        failureCount: recipients.length
      };
    }

    const successful: Array<{ phoneNumber: string; messageId: string }> = [];
    const failed: Array<{ phoneNumber: string; error: string }> = [];

    // Process in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      
      const promises = batch.map(async (recipient) => {
        const processedMessage = this.processTemplate(
          recipient.message, 
          { ...options.variables, ...recipient.variables }
        );

        const result = await this.sendSMS(recipient.phoneNumber, processedMessage, options);
        
        if (result.success) {
          successful.push({
            phoneNumber: recipient.phoneNumber,
            messageId: result.messageId!
          });
        } else {
          failed.push({
            phoneNumber: recipient.phoneNumber,
            error: result.error!
          });
        }
      });

      await Promise.all(promises);

      // Add delay between batches to respect rate limits
      if (i + batchSize < recipients.length) {
        await this.delay(1000); // 1 second delay
      }
    }

    return {
      successful,
      failed,
      total: recipients.length,
      successCount: successful.length,
      failureCount: failed.length
    };
  }

  // Send OTP SMS with predefined template
  async sendOTPSMS(
    phoneNumber: string,
    otpCode: string,
    appName: string = APP_CONFIG.NAME,
    expiryMinutes: number = 5
  ): Promise<SMSResult> {
    const message = `Your ${appName} verification code is: ${otpCode}. This code expires in ${expiryMinutes} minutes. Do not share this code with anyone.`;
    
    return this.sendSMS(phoneNumber, message, {
      template: 'otp_verification',
      variables: {
        code: otpCode,
        appName,
        expiryMinutes: expiryMinutes.toString()
      },
      validityPeriod: expiryMinutes * 60 // Convert to seconds
    });
  }

  // Get message status
  async getMessageStatus(messageId: string): Promise<{
    success: boolean;
    status?: string;
    error?: string;
  }> {
    if (!this.isEnabled) {
      return {
        success: false,
        error: 'Twilio SMS service is not enabled'
      };
    }

    try {
      const message = await this.client.messages(messageId).fetch();
      return {
        success: true,
        status: message.status
      };
    } catch (error: any) {
      return {
        success: false,
        error: this.formatTwilioError(error)
      };
    }
  }

  // Private helper methods

  // Validate phone number format
  private isValidPhoneNumber(phoneNumber: string): boolean {
    // Basic validation - should start with + and contain only digits
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber);
  }

  // Process template variables
  private processTemplate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] || match;
    });
  }

  // Format Twilio error messages
  private formatTwilioError(error: any): string {
    if (error.code) {
      switch (error.code) {
        case 21211:
          return 'Invalid phone number format';
        case 21408:
          return 'Permission to send SMS has not been enabled for your region';
        case 21610:
          return 'Message cannot be sent to this number (likely blocked or invalid)';
        case 21614:
          return 'Message body is invalid (possibly containing invalid characters)';
        case 30001:
          return 'Message queue is full, please try again later';
        case 30002:
          return 'Account suspended';
        case 30003:
          return 'Unreachable destination phone number';
        case 30004:
          return 'Message blocked by carrier';
        case 30005:
          return 'Unknown destination phone number';
        case 30006:
          return 'Message delivery failed';
        default:
          return error.message || 'Unknown Twilio error';
      }
    }
    return error.message || 'SMS delivery failed';
  }

  // Check if error is retryable
  private isRetryableError(error: any): boolean {
    const retryableCodes = [
      30001, // Queue full
      30006, // Delivery failed
      20429, // Rate limit
      50000, // Internal server error
    ];
    
    return retryableCodes.includes(error.code) || 
           /rate limit|queue full|try again|timeout|network/i.test(error.message);
  }

  // Mask phone number for logging
  private maskPhoneNumber(phoneNumber: string): string {
    if (phoneNumber.length <= 4) return phoneNumber;
    const countryCode = phoneNumber.substring(0, phoneNumber.length - 10);
    const masked = phoneNumber.substring(phoneNumber.length - 10, phoneNumber.length - 4).replace(/\d/g, '*');
    const lastFour = phoneNumber.substring(phoneNumber.length - 4);
    return `${countryCode}${masked}${lastFour}`;
  }

  // Utility delay function
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get service status
  getServiceStatus(): {
    enabled: boolean;
    configured: boolean;
    fromNumber?: string;
    messagingServiceSid?: string;
  } {
    return {
      enabled: this.isEnabled,
      configured: this.isEnabled && !!this.client,
      fromNumber: this.fromNumber,
      messagingServiceSid: this.messagingServiceSid
    };
  }
}

// Export singleton instance
export const twilioSMSService = TwilioSMSService.getInstance();