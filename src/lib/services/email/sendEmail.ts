import { emailProvider, EmailResult } from './provider';
import { otpEmailTemplate, generateOTPTemplateData } from './templates/otp';
import { resetPasswordEmailTemplate, generateResetPasswordTemplateData } from './templates/reset-password';
import { welcomeEmailTemplate, generateWelcomeTemplateData } from './templates/welcome';
import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import { APP_CONFIG, OTP_CONFIG } from '@/lib/utils/constants';
import { analyticsTracker } from '../analytics/tracker';

export interface EmailOptions {
  template?: string;
  variables?: Record<string, string>;
  priority?: 'high' | 'normal' | 'low';
  retryAttempts?: number;
  retryDelay?: number;
}

export interface BulkEmailOptions extends EmailOptions {
  batchSize?: number;
  delayBetweenBatches?: number;
}

export interface EmailQueueItem {
  id: string;
  to: string | string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  options: EmailOptions;
  attempts: number;
  createdAt: Date;
  scheduledAt?: Date;
  lastAttemptAt?: Date;
  error?: string;
}

export class EmailService {
  private static instance: EmailService;
  private emailQueue: EmailQueueItem[] = [];
  private isProcessingQueue = false;
  private readonly maxRetries = 3;
  private readonly retryDelay = 5000; // 5 seconds

  private constructor() {
    // Initialize email templates in database
    this.initializeEmailTemplates();
    
    // Start queue processor
    this.startQueueProcessor();
  }

  static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  // Initialize default email templates in database
  private async initializeEmailTemplates(): Promise<void> {
    try {
      const templates = [
        { name: 'otp_verification', template: otpEmailTemplate },
        { name: 'reset_password', template: resetPasswordEmailTemplate },
        { name: 'welcome', template: welcomeEmailTemplate }
      ];

      for (const { name, template } of templates) {
        await emailProvider.saveEmailTemplate(name, template);
      }

      console.log('Email templates initialized successfully');
    } catch (error) {
      console.error('Error initializing email templates:', error);
    }
  }

  // Send single email
  async sendEmail(
    to: string | string[],
    subject: string,
    htmlBody: string,
    textBody?: string,
    options: EmailOptions = {}
  ): Promise<EmailResult> {
    try {
      // Track email attempt
      await analyticsTracker.trackFeatureUsage(
        'system',
        'email',
        'send_attempt',
        { 
          to: Array.isArray(to) ? to.length : 1,
          template: options.template,
          priority: options.priority || 'normal'
        }
      );

      // Add to queue if high priority or retry needed
      if (options.priority === 'high' || options.retryAttempts) {
        return await this.addToQueue(to, subject, htmlBody, textBody, options);
      }

      // Send immediately for normal emails
      const result = await emailProvider.sendEmail(to, subject, htmlBody, textBody, options);

      // Track result
      await analyticsTracker.trackFeatureUsage(
        'system',
        'email',
        'send_result',
        { 
          success: result.success,
          provider: result.provider,
          error: result.error
        }
      );

      return result;

    } catch (error: any) {
      await analyticsTracker.trackError(error, 'system', { 
        component: 'email_service',
        action: 'send_email'
      });

      return {
        success: false,
        error: error.message,
        retryable: true
      };
    }
  }

  // Send OTP email (backup method)
  async sendOTPEmail(
    email: string,
    otp: string,
    userName: string,
    phoneNumber?: string
  ): Promise<EmailResult> {
    try {
      const templateData = generateOTPTemplateData(otp, userName, phoneNumber);
      
      return await this.sendTemplatedEmail(
        email,
        'otp_verification',
        templateData,
        { priority: 'high', retryAttempts: 3 }
      );

    } catch (error: any) {
      console.error('Error sending OTP email:', error);
      return {
        success: false,
        error: error.message,
        retryable: true
      };
    }
  }

  // Send welcome email after phone registration
  async sendWelcomeEmail(
    email: string,
    userName: string,
    phoneNumber: string,
    additionalData?: Record<string, any>
  ): Promise<EmailResult> {
    try {
      const templateData = generateWelcomeTemplateData(userName, phoneNumber, additionalData);
      
      return await this.sendTemplatedEmail(
        email,
        'welcome',
        templateData,
        { priority: 'normal' }
      );

    } catch (error: any) {
      console.error('Error sending welcome email:', error);
      return {
        success: false,
        error: error.message,
        retryable: true
      };
    }
  }

  // Send password reset email (secondary recovery)
  async sendPasswordResetEmail(
    email: string,
    resetToken: string,
    userName: string,
    phoneNumber?: string
  ): Promise<EmailResult> {
    try {
      const templateData = generateResetPasswordTemplateData(resetToken, userName, phoneNumber);
      
      return await this.sendTemplatedEmail(
        email,
        'reset_password',
        templateData,
        { priority: 'high', retryAttempts: 2 }
      );

    } catch (error: any) {
      console.error('Error sending password reset email:', error);
      return {
        success: false,
        error: error.message,
        retryable: true
      };
    }
  }

  // Send notification email
  async sendNotificationEmail(
    email: string,
    subject: string,
    message: string,
    actionUrl?: string,
    actionText?: string
  ): Promise<EmailResult> {
    try {
      const htmlBody = this.generateNotificationHtml(message, actionUrl, actionText);
      const textBody = this.generateNotificationText(message, actionUrl, actionText);

      return await this.sendEmail(
        email,
        subject,
        htmlBody,
        textBody,
        { priority: 'normal' }
      );

    } catch (error: any) {
      console.error('Error sending notification email:', error);
      return {
        success: false,
        error: error.message,
        retryable: true
      };
    }
  }

  // Send templated email
  async sendTemplatedEmail(
    to: string | string[],
    templateName: string,
    templateData: Record<string, any>,
    options: EmailOptions = {}
  ): Promise<EmailResult> {
    try {
      const template = await emailProvider.getEmailTemplate(templateName);
      if (!template) {
        return {
          success: false,
          error: `Email template '${templateName}' not found`,
          retryable: false
        };
      }

      return await this.sendEmail(
        to,
        template.subject,
        template.htmlBody,
        template.textBody,
        { ...options, template: templateName, variables: templateData }
      );

    } catch (error: any) {
      console.error('Error sending templated email:', error);
      return {
        success: false,
        error: error.message,
        retryable: true
      };
    }
  }

  // Send bulk emails
  async sendBulkEmails(
    recipients: Array<{
      email: string;
      templateData: Record<string, any>;
    }>,
    templateName: string,
    options: BulkEmailOptions = {}
  ): Promise<{
    successful: string[];
    failed: Array<{ email: string; error: string }>;
    total: number;
  }> {
    const successful: string[] = [];
    const failed: Array<{ email: string; error: string }> = [];
    const batchSize = options.batchSize || 50;
    const delayBetweenBatches = options.delayBetweenBatches || 1000;

    // Process in batches
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (recipient) => {
        try {
          const result = await this.sendTemplatedEmail(
            recipient.email,
            templateName,
            recipient.templateData,
            options
          );

          if (result.success) {
            successful.push(recipient.email);
          } else {
            failed.push({
              email: recipient.email,
              error: result.error || 'Unknown error'
            });
          }
        } catch (error: any) {
          failed.push({
            email: recipient.email,
            error: error.message
          });
        }
      });

      await Promise.allSettled(batchPromises);

      // Delay between batches
      if (i + batchSize < recipients.length) {
        await this.delay(delayBetweenBatches);
      }
    }

    return {
      successful,
      failed,
      total: recipients.length
    };
  }

  // Add email to queue for retry mechanism
  private async addToQueue(
    to: string | string[],
    subject: string,
    htmlBody: string,
    textBody?: string,
    options: EmailOptions = {}
  ): Promise<EmailResult> {
    const queueItem: EmailQueueItem = {
      id: this.generateId(),
      to,
      subject,
      htmlBody,
      textBody,
      options,
      attempts: 0,
      createdAt: new Date()
    };

    this.emailQueue.push(queueItem);

    // Try to process immediately
    if (!this.isProcessingQueue) {
      this.processQueue();
    }

    return {
      success: true,
      messageId: queueItem.id,
      provider: 'queued'
    };
  }

  // Process email queue
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.emailQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      while (this.emailQueue.length > 0) {
        const item = this.emailQueue.shift()!;
        
        try {
          const result = await emailProvider.sendEmail(
            item.to,
            item.subject,
            item.htmlBody,
            item.textBody,
            item.options
          );

          if (!result.success && result.retryable && item.attempts < this.maxRetries) {
            // Retry logic
            item.attempts++;
            item.lastAttemptAt = new Date();
            item.error = result.error;
            
            // Add back to queue with delay
            setTimeout(() => {
              this.emailQueue.push(item);
            }, this.retryDelay * item.attempts);
          }

        } catch (error: any) {
          console.error('Error processing email queue item:', error);
          
          if (item.attempts < this.maxRetries) {
            item.attempts++;
            item.lastAttemptAt = new Date();
            item.error = error.message;
            
            setTimeout(() => {
              this.emailQueue.push(item);
            }, this.retryDelay * item.attempts);
          }
        }

        // Small delay between processing items
        await this.delay(100);
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  // Start queue processor
  private startQueueProcessor(): void {
    setInterval(() => {
      if (!this.isProcessingQueue && this.emailQueue.length > 0) {
        this.processQueue();
      }
    }, 30000); // Check every 30 seconds
  }

  // Generate notification HTML
  private generateNotificationHtml(message: string, actionUrl?: string, actionText?: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Notification</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">${APP_CONFIG.NAME}</h1>
    </div>
    
    <div style="background: #fff; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
        <div style="margin-bottom: 20px;">
            ${message}
        </div>
        
        ${actionUrl && actionText ? `
        <div style="text-align: center; margin: 30px 0;">
            <a href="${actionUrl}" style="background: #25D366; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                ${actionText}
            </a>
        </div>
        ` : ''}
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 14px;">
            <p>${APP_CONFIG.NAME} Team</p>
            <p>Need help? Contact us at <a href="mailto:${APP_CONFIG.SUPPORT_EMAIL}">${APP_CONFIG.SUPPORT_EMAIL}</a></p>
        </div>
    </div>
</body>
</html>
    `;
  }

  // Generate notification text
  private generateNotificationText(message: string, actionUrl?: string, actionText?: string): string {
    return `
${APP_CONFIG.NAME} - Notification

${message}

${actionUrl ? `${actionText || 'Click here'}: ${actionUrl}` : ''}

${APP_CONFIG.NAME} Team
Need help? Contact us at ${APP_CONFIG.SUPPORT_EMAIL}
    `.trim();
  }

  // Helper methods
  private generateId(): string {
    return `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get queue status
  getQueueStatus(): {
    queueLength: number;
    isProcessing: boolean;
    totalProcessed: number;
  } {
    return {
      queueLength: this.emailQueue.length,
      isProcessing: this.isProcessingQueue,
      totalProcessed: 0 // Could be tracked if needed
    };
  }
}

// Export singleton instance
export const emailService = EmailService.getInstance();