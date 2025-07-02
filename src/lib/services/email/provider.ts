import { connectDB } from '@/lib/db/connection';
import Settings from '@/lib/db/models/Settings';
import { SESService } from '../aws/ses';

export interface EmailProviderConfig {
  provider: 'sendgrid' | 'nodemailer' | 'ses';
  isActive: boolean;
  config: {
    // SendGrid
    sendgridApiKey?: string;
    // NodeMailer SMTP
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPass?: string;
    smtpSecure?: boolean;
    // SES (handled by SESService)
    awsRegion?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    // Common
    fromEmail: string;
    fromName: string;
    replyToEmail?: string;
  };
  priority: number; // Higher number = higher priority
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
  retryable?: boolean;
}

export interface EmailTemplate {
  subject: string;
  htmlBody: string;
  textBody: string;
}

export class EmailProviderService {
  private static instance: EmailProviderService;
  private providers: EmailProviderConfig[] = [];
  private currentProvider: EmailProviderConfig | null = null;

  private constructor() {
    this.initializeProviders();
  }

  static getInstance(): EmailProviderService {
    if (!EmailProviderService.instance) {
      EmailProviderService.instance = new EmailProviderService();
    }
    return EmailProviderService.instance;
  }

  // Initialize email providers from settings
  private async initializeProviders(): Promise<void> {
    try {
      await connectDB();

      const emailSettings = await Settings.find({
        category: 'email'
      });

      const providerConfig = this.parseEmailSettings(emailSettings);
      
      // Sort by priority (highest first)
      this.providers = providerConfig.sort((a, b) => b.priority - a.priority);
      
      // Set current provider to highest priority active provider
      this.currentProvider = this.providers.find(p => p.isActive) || null;

      console.log(`Initialized ${this.providers.length} email providers`);
      if (this.currentProvider) {
        console.log(`Active provider: ${this.currentProvider.provider}`);
      }

    } catch (error) {
      console.error('Error initializing email providers:', error);
      // Fallback to environment variables
      this.initializeFromEnvironment();
    }
  }

  // Parse email settings from database
  private parseEmailSettings(settings: any[]): EmailProviderConfig[] {
    const configs: EmailProviderConfig[] = [];
    
    // Group settings by provider
    const grouped = settings.reduce((acc, setting) => {
      const provider = this.getProviderFromKey(setting.key);
      if (!acc[provider]) acc[provider] = {};
      acc[provider][setting.key] = setting.value;
      return acc;
    }, {} as Record<string, any>);

    // Create provider configs
    Object.entries(grouped).forEach(([provider, config]) => {
      if (provider !== 'unknown') {
        configs.push(this.createProviderConfig(provider as any, config));
      }
    });

    return configs;
  }

  // Get provider from setting key
  private getProviderFromKey(key: string): string {
    if (key.includes('sendgrid')) return 'sendgrid';
    if (key.includes('smtp') || key.includes('nodemailer')) return 'nodemailer';
    if (key.includes('ses') || key.includes('aws')) return 'ses';
    return 'unknown';
  }

  // Create provider configuration
  private createProviderConfig(provider: string, config: any): EmailProviderConfig {
    const baseConfig = {
      provider: provider as 'sendgrid' | 'nodemailer' | 'ses',
      isActive: config.enabled || false,
      priority: config.priority || 1,
      config: {
        fromEmail: config.fromEmail || process.env.EMAIL_FROM!,
        fromName: config.fromName || 'WhatsApp Clone',
        replyToEmail: config.replyToEmail || config.fromEmail
      }
    };

    switch (provider) {
      case 'sendgrid':
        return {
          ...baseConfig,
          config: {
            ...baseConfig.config,
            sendgridApiKey: config.sendgridApiKey || process.env.SENDGRID_API_KEY
          }
        };

      case 'nodemailer':
        return {
          ...baseConfig,
          config: {
            ...baseConfig.config,
            smtpHost: config.smtpHost || process.env.SMTP_HOST,
            smtpPort: config.smtpPort || parseInt(process.env.SMTP_PORT || '587'),
            smtpUser: config.smtpUser || process.env.SMTP_USER,
            smtpPass: config.smtpPass || process.env.SMTP_PASS,
            smtpSecure: config.smtpSecure || false
          }
        };

      case 'ses':
        return {
          ...baseConfig,
          config: {
            ...baseConfig.config,
            awsRegion: config.awsRegion || process.env.AWS_SES_REGION,
            awsAccessKeyId: config.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID,
            awsSecretAccessKey: config.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY
          }
        };

      default:
        return baseConfig as EmailProviderConfig;
    }
  }

  // Initialize from environment variables as fallback
  private initializeFromEnvironment(): void {
    const providers: EmailProviderConfig[] = [];

    // SES Provider (highest priority if configured)
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      providers.push({
        provider: 'ses',
        isActive: true,
        priority: 3,
        config: {
          fromEmail: process.env.EMAIL_FROM!,
          fromName: 'WhatsApp Clone',
          replyToEmail: process.env.EMAIL_REPLY_TO,
          awsRegion: process.env.AWS_SES_REGION,
          awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
          awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
      });
    }

    // SendGrid Provider
    if (process.env.SENDGRID_API_KEY) {
      providers.push({
        provider: 'sendgrid',
        isActive: true,
        priority: 2,
        config: {
          fromEmail: process.env.EMAIL_FROM!,
          fromName: 'WhatsApp Clone',
          replyToEmail: process.env.EMAIL_REPLY_TO,
          sendgridApiKey: process.env.SENDGRID_API_KEY
        }
      });
    }

    // SMTP Provider (lowest priority)
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      providers.push({
        provider: 'nodemailer',
        isActive: true,
        priority: 1,
        config: {
          fromEmail: process.env.EMAIL_FROM!,
          fromName: 'WhatsApp Clone',
          replyToEmail: process.env.EMAIL_REPLY_TO,
          smtpHost: process.env.SMTP_HOST,
          smtpPort: parseInt(process.env.SMTP_PORT || '587'),
          smtpUser: process.env.SMTP_USER,
          smtpPass: process.env.SMTP_PASS,
          smtpSecure: process.env.SMTP_SECURE === 'true'
        }
      });
    }

    this.providers = providers.sort((a, b) => b.priority - a.priority);
    this.currentProvider = this.providers.find(p => p.isActive) || null;
  }

  // Send email using current provider with fallback
  async sendEmail(
    to: string | string[],
    subject: string,
    htmlBody: string,
    textBody?: string,
    options: { template?: string; variables?: Record<string, string> } = {}
  ): Promise<EmailResult> {
    if (!this.currentProvider) {
      return {
        success: false,
        error: 'No email provider configured',
        retryable: false
      };
    }

    // Process template variables
    const processedSubject = this.processTemplate(subject, options.variables || {});
    const processedHtml = this.processTemplate(htmlBody, options.variables || {});
    const processedText = textBody ? this.processTemplate(textBody, options.variables || {}) : undefined;

    // Try current provider first
    let result = await this.sendWithProvider(
      this.currentProvider,
      to,
      processedSubject,
      processedHtml,
      processedText
    );

    // If failed and retryable, try other providers
    if (!result.success && result.retryable) {
      console.log(`Primary provider ${this.currentProvider.provider} failed, trying fallbacks...`);
      
      for (const provider of this.providers) {
        if (provider !== this.currentProvider && provider.isActive) {
          result = await this.sendWithProvider(
            provider,
            to,
            processedSubject,
            processedHtml,
            processedText
          );
          
          if (result.success) {
            console.log(`Fallback provider ${provider.provider} succeeded`);
            break;
          }
        }
      }
    }

    return result;
  }

  // Send email with specific provider
  private async sendWithProvider(
    provider: EmailProviderConfig,
    to: string | string[],
    subject: string,
    htmlBody: string,
    textBody?: string
  ): Promise<EmailResult> {
    try {
      switch (provider.provider) {
        case 'ses':
          return await this.sendWithSES(provider, to, subject, htmlBody, textBody);
        
        case 'sendgrid':
          return await this.sendWithSendGrid(provider, to, subject, htmlBody, textBody);
        
        case 'nodemailer':
          return await this.sendWithNodeMailer(provider, to, subject, htmlBody, textBody);
        
        default:
          return {
            success: false,
            error: `Unsupported provider: ${provider.provider}`,
            retryable: false
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        provider: provider.provider,
        retryable: this.isRetryableError(error)
      };
    }
  }

  // Send with SES
  private async sendWithSES(
    provider: EmailProviderConfig,
    to: string | string[],
    subject: string,
    htmlBody: string,
    textBody?: string
  ): Promise<EmailResult> {
    const sesService = new SESService();
    const result = await sesService.sendEmail(to, subject, htmlBody, textBody);
    
    return {
      success: result.success,
      messageId: result.messageId,
      provider: 'ses',
      error: result.error,
      retryable: result.error ? this.isRetryableError(new Error(result.error)) : false
    };
  }

  // Send with SendGrid
  private async sendWithSendGrid(
    provider: EmailProviderConfig,
    to: string | string[],
    subject: string,
    htmlBody: string,
    textBody?: string
  ): Promise<EmailResult> {
    // Implementation for SendGrid
    // This would require @sendgrid/mail package
    return {
      success: false,
      error: 'SendGrid implementation pending',
      provider: 'sendgrid',
      retryable: false
    };
  }

  // Send with NodeMailer
  private async sendWithNodeMailer(
    provider: EmailProviderConfig,
    to: string | string[],
    subject: string,
    htmlBody: string,
    textBody?: string
  ): Promise<EmailResult> {
    // Implementation for NodeMailer
    // This would require nodemailer package
    return {
      success: false,
      error: 'NodeMailer implementation pending',
      provider: 'nodemailer',
      retryable: false
    };
  }

  // Process template variables
  private processTemplate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] || match;
    });
  }

  // Check if error is retryable
  private isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      /rate limit/i,
      /quota exceeded/i,
      /temporary/i,
      /timeout/i,
      /network/i,
      /connection/i,
      /service unavailable/i
    ];

    return retryablePatterns.some(pattern => pattern.test(error.message));
  }

  // Get email template from database
  async getEmailTemplate(templateName: string): Promise<EmailTemplate | null> {
    try {
      await connectDB();

      const setting = await Settings.findOne({
        category: 'email',
        key: `template_${templateName}`
      });

      return setting?.value || null;
    } catch (error) {
      console.error('Error getting email template:', error);
      return null;
    }
  }

  // Save email template to database
  async saveEmailTemplate(templateName: string, template: EmailTemplate): Promise<void> {
    try {
      await connectDB();

      await Settings.findOneAndUpdate(
        { category: 'email', key: `template_${templateName}` },
        {
          value: template,
          type: 'object',
          description: `Email template for ${templateName}`,
          isPublic: false,
          updatedBy: 'system'
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error('Error saving email template:', error);
      throw error;
    }
  }

  // Get current provider info
  getCurrentProvider(): EmailProviderConfig | null {
    return this.currentProvider;
  }

  // Get all providers
  getAllProviders(): EmailProviderConfig[] {
    return [...this.providers];
  }

  // Refresh providers from database
  async refreshProviders(): Promise<void> {
    await this.initializeProviders();
  }
}

// Export singleton instance
export const emailProvider = EmailProviderService.getInstance();