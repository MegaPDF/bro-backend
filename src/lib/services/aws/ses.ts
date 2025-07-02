import { SES } from 'aws-sdk';
import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import { APP_CONFIG } from '@/lib/utils/constants';

export interface EmailOptions {
  template?: string;
  variables?: Record<string, string>;
  priority?: 'high' | 'normal' | 'low';
  trackOpens?: boolean;
  trackClicks?: boolean;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface BulkEmailResult {
  successful: string[];
  failed: Array<{
    email: string;
    error: string;
  }>;
  total: number;
  successCount: number;
  failureCount: number;
}

export interface EmailTemplate {
  subject: string;
  htmlBody: string;
  textBody: string;
}

export class SESService {
  private ses: SES;
  private fromEmail: string;
  private replyToEmail: string;
  private configurationSet?: string;

  constructor() {
    this.ses = new SES({
      region: process.env.AWS_SES_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });

    this.fromEmail = process.env.EMAIL_FROM || `noreply@${APP_CONFIG.NAME.toLowerCase().replace(/\s+/g, '')}.com`;
    this.replyToEmail = process.env.EMAIL_REPLY_TO || this.fromEmail;
    this.configurationSet = process.env.SES_CONFIGURATION_SET;
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
      const recipients = Array.isArray(to) ? to : [to];
      
      // Validate email addresses
      for (const email of recipients) {
        if (!this.isValidEmail(email)) {
          return {
            success: false,
            error: `Invalid email address: ${email}`
          };
        }
      }

      // Process template variables
      const processedHtml = this.processTemplate(htmlBody, options.variables || {});
      const processedText = textBody ? this.processTemplate(textBody, options.variables || {}) : undefined;
      const processedSubject = this.processTemplate(subject, options.variables || {});

      const params: SES.SendEmailRequest = {
        Source: this.fromEmail,
        Destination: {
          ToAddresses: recipients
        },
        Message: {
          Subject: {
            Data: processedSubject,
            Charset: 'UTF-8'
          },
          Body: {
            Html: {
              Data: processedHtml,
              Charset: 'UTF-8'
            },
            ...(processedText && {
              Text: {
                Data: processedText,
                Charset: 'UTF-8'
              }
            })
          }
        },
        ReplyToAddresses: [options.replyTo || this.replyToEmail],
        ...(this.configurationSet && { ConfigurationSetName: this.configurationSet })
      };

      const result = await this.ses.sendEmail(params).promise();

      // Log email for tracking
      await this.logEmail({
        messageId: result.MessageId,
        to: recipients,
        subject: processedSubject,
        template: options.template,
        sentAt: new Date()
      });

      return {
        success: true,
        messageId: result.MessageId
      };

    } catch (error: any) {
      console.error('SES send email error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Send templated email
  async sendTemplatedEmail(
    to: string | string[],
    templateName: string,
    templateData: Record<string, any> = {},
    options: EmailOptions = {}
  ): Promise<EmailResult> {
    try {
      const template = await this.getEmailTemplate(templateName);
      if (!template) {
        return {
          success: false,
          error: `Email template '${templateName}' not found`
        };
      }

      return await this.sendEmail(
        to,
        template.subject,
        template.htmlBody,
        template.textBody,
        {
          ...options,
          variables: { ...templateData, ...options.variables },
          template: templateName
        }
      );

    } catch (error: any) {
      console.error('SES send templated email error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Send bulk emails
  async sendBulkEmail(
    recipients: Array<{
      email: string;
      variables?: Record<string, any>;
    }>,
    templateName: string,
    globalVariables: Record<string, any> = {},
    options: EmailOptions = {}
  ): Promise<BulkEmailResult> {
    const successful: string[] = [];
    const failed: Array<{ email: string; error: string }> = [];

    // Process in batches to avoid rate limits
    const batchSize = 50; // SES limit
    const batches = this.chunkArray(recipients, batchSize);

    for (const batch of batches) {
      const batchPromises = batch.map(async (recipient) => {
        try {
          const mergedVariables = { ...globalVariables, ...recipient.variables };
          const result = await this.sendTemplatedEmail(
            recipient.email,
            templateName,
            mergedVariables,
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

      // Wait for batch to complete before processing next batch
      await Promise.allSettled(batchPromises);

      // Add delay between batches to respect rate limits
      if (batches.indexOf(batch) < batches.length - 1) {
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

  // Send OTP email
  async sendOTPEmail(
    email: string,
    otp: string,
    expiryMinutes: number = 5,
    userName?: string
  ): Promise<EmailResult> {
    return await this.sendTemplatedEmail(
      email,
      'otp_verification',
      {
        otp,
        expiryMinutes: expiryMinutes.toString(),
        userName: userName || 'User',
        appName: APP_CONFIG.NAME,
        supportEmail: APP_CONFIG.SUPPORT_EMAIL
      }
    );
  }

  // Send welcome email
  async sendWelcomeEmail(
    email: string,
    userName: string,
    additionalData?: Record<string, any>
  ): Promise<EmailResult> {
    return await this.sendTemplatedEmail(
      email,
      'welcome',
      {
        userName,
        appName: APP_CONFIG.NAME,
        supportEmail: APP_CONFIG.SUPPORT_EMAIL,
        websiteUrl: APP_CONFIG.WEBSITE,
        ...additionalData
      }
    );
  }

  // Send password reset email
  async sendPasswordResetEmail(
    email: string,
    resetToken: string,
    userName?: string
  ): Promise<EmailResult> {
    const resetUrl = `${APP_CONFIG.WEBSITE}/reset-password?token=${resetToken}`;
    
    return await this.sendTemplatedEmail(
      email,
      'password_reset',
      {
        resetUrl,
        userName: userName || 'User',
        appName: APP_CONFIG.NAME,
        supportEmail: APP_CONFIG.SUPPORT_EMAIL
      }
    );
  }

  // Send notification email
  async sendNotificationEmail(
    email: string,
    subject: string,
    message: string,
    actionUrl?: string,
    actionText?: string
  ): Promise<EmailResult> {
    return await this.sendTemplatedEmail(
      email,
      'notification',
      {
        subject,
        message,
        actionUrl,
        actionText,
        appName: APP_CONFIG.NAME,
        supportEmail: APP_CONFIG.SUPPORT_EMAIL
      }
    );
  }

  // Verify email address
  async verifyEmailAddress(email: string): Promise<{ isValid: boolean; deliverability?: string }> {
    try {
      const result = await this.ses.getIdentityVerificationAttributes({
        Identities: [email]
      }).promise();

      const attributes = result.VerificationAttributes[email];
      
      return {
        isValid: attributes?.VerificationStatus === 'Success',
        deliverability: attributes?.VerificationStatus
      };

    } catch (error: any) {
      console.error('Email verification error:', error);
      return { isValid: false };
    }
  }

  // Get send statistics
  async getSendStatistics(): Promise<{
    sent: number;
    bounces: number;
    complaints: number;
    deliveries: number;
    rejects: number;
  }> {
    try {
      const result = await this.ses.getSendStatistics().promise();
      
      const stats = result.SendDataPoints?.reduce(
        (acc, point) => ({
          sent: acc.sent + (point.DeliveryAttempts || 0),
          bounces: acc.bounces + (point.Bounces || 0),
          complaints: acc.complaints + (point.Complaints || 0),
          deliveries: acc.deliveries + (point.DeliveryAttempts || 0) - (point.Bounces || 0) - (point.Rejects || 0),
          rejects: acc.rejects + (point.Rejects || 0)
        }),
        { sent: 0, bounces: 0, complaints: 0, deliveries: 0, rejects: 0 }
      );

      return stats || { sent: 0, bounces: 0, complaints: 0, deliveries: 0, rejects: 0 };

    } catch (error: any) {
      console.error('Get send statistics error:', error);
      return { sent: 0, bounces: 0, complaints: 0, deliveries: 0, rejects: 0 };
    }
  }

  // Get send quota
  async getSendQuota(): Promise<{
    max24HourSend: number;
    maxSendRate: number;
    sentLast24Hours: number;
  }> {
    try {
      const result = await this.ses.getSendQuota().promise();
      
      return {
        max24HourSend: result.Max24HourSend || 0,
        maxSendRate: result.MaxSendRate || 0,
        sentLast24Hours: result.SentLast24Hours || 0
      };

    } catch (error: any) {
      console.error('Get send quota error:', error);
      return { max24HourSend: 0, maxSendRate: 0, sentLast24Hours: 0 };
    }
  }

  // Private helper methods
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private processTemplate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] || match;
    });
  }

  private async getEmailTemplate(templateName: string): Promise<EmailTemplate | null> {
    try {
      await connectDB();

      const setting = await Settings.findOne({
        category: 'email',
        key: `template_${templateName}`
      });

      return setting?.value || null;

    } catch (error) {
      console.error('Get email template error:', error);
      return null;
    }
  }

  private async logEmail(logData: {
    messageId: string;
    to: string[];
    subject: string;
    template?: string;
    sentAt: Date;
  }): Promise<void> {
    try {
      await connectDB();

      // Store email log in analytics or separate collection
      // Implementation depends on your logging requirements
      
    } catch (error) {
      console.error('Email logging error:', error);
    }
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const sesService = new SESService();