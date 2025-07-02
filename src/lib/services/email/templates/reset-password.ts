import { APP_CONFIG } from '@/lib/utils/constants';

export interface ResetPasswordTemplateData {
  resetUrl: string;
  userName: string;
  appName: string;
  supportEmail: string;
  websiteUrl: string;
  expiryHours: string;
  phoneNumber?: string;
}

export const resetPasswordEmailTemplate = {
  subject: 'Reset Your {{appName}} Account Access',
  
  htmlBody: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Account Access</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            background-color: #f8f9fa;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }
        .header {
            background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
            color: white;
            padding: 40px 20px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 600;
        }
        .header .icon {
            font-size: 48px;
            margin-bottom: 10px;
        }
        .content {
            padding: 40px 30px;
        }
        .greeting {
            font-size: 18px;
            margin-bottom: 20px;
            color: #2c3e50;
        }
        .warning-notice {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 6px;
            padding: 15px;
            margin: 20px 0;
            color: #856404;
            font-size: 14px;
        }
        .reset-button {
            display: inline-block;
            background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
            color: white !important;
            padding: 16px 32px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            font-size: 16px;
            margin: 30px 0;
            text-align: center;
            transition: all 0.3s ease;
        }
        .reset-button:hover {
            background: linear-gradient(135deg, #c82333 0%, #a71e2a 100%);
        }
        .button-container {
            text-align: center;
            margin: 30px 0;
        }
        .expiry-notice {
            background-color: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 6px;
            padding: 15px;
            margin: 20px 0;
            color: #721c24;
            font-size: 14px;
            text-align: center;
        }
        .alternative-link {
            background-color: #e9ecef;
            border-radius: 6px;
            padding: 20px;
            margin: 20px 0;
            word-break: break-all;
        }
        .alternative-link p {
            margin: 0 0 10px 0;
            font-weight: 600;
            color: #495057;
            font-size: 14px;
        }
        .alternative-link code {
            background-color: #f8f9fa;
            padding: 8px;
            border-radius: 4px;
            font-size: 12px;
            color: #dc3545;
            display: block;
            border: 1px solid #dee2e6;
            word-break: break-all;
        }
        .security-info {
            background-color: #d1ecf1;
            border: 1px solid #bee5eb;
            border-radius: 6px;
            padding: 20px;
            margin: 20px 0;
            font-size: 14px;
            color: #0c5460;
        }
        .footer {
            background-color: #f8f9fa;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e9ecef;
        }
        .footer p {
            margin: 5px 0;
            font-size: 14px;
            color: #6c757d;
        }
        .footer a {
            color: #dc3545;
            text-decoration: none;
        }
        @media only screen and (max-width: 600px) {
            .container {
                margin: 0;
                border-radius: 0;
            }
            .content {
                padding: 30px 20px;
            }
            .reset-button {
                padding: 14px 24px;
                font-size: 14px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="icon">🔐</div>
            <h1>{{appName}}</h1>
        </div>
        
        <div class="content">
            <div class="greeting">
                Hello {{userName}},
            </div>
            
            <div class="warning-notice">
                <strong>Account Recovery Request</strong><br>
                Someone requested to reset access to your {{appName}} account. This is a secondary recovery method since {{appName}} primarily uses phone number authentication.
            </div>
            
            <p>If this was you, click the button below to reset your account access:</p>
            
            <div class="button-container">
                <a href="{{resetUrl}}" class="reset-button">Reset Account Access</a>
            </div>
            
            <div class="expiry-notice">
                ⏰ This reset link will expire in {{expiryHours}} hours for security reasons.
            </div>
            
            <div class="alternative-link">
                <p>If the button doesn't work, copy and paste this link into your browser:</p>
                <code>{{resetUrl}}</code>
            </div>
            
            <div class="security-info">
                <h3 style="margin-top: 0; color: #0c5460;">🛡️ Security Information:</h3>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li>If you didn't request this reset, please ignore this email</li>
                    <li>Your account remains secure until you click the reset link</li>
                    <li>Remember: {{appName}} uses phone number as primary authentication</li>
                    <li>Contact support if you suspect unauthorized access</li>
                </ul>
            </div>
            
            <p style="color: #666; font-size: 14px; margin-top: 30px;">
                <strong>Why did I receive this email?</strong><br>
                This email was sent because someone requested account recovery for the {{appName}} account associated with this email address. If you have concerns about your account security, please contact our support team immediately.
            </p>
        </div>
        
        <div class="footer">
            <p><strong>{{appName}} Team</strong></p>
            <p>Need help? Contact us at <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p>
            <p>Visit our website: <a href="{{websiteUrl}}">{{websiteUrl}}</a></p>
            <p style="margin-top: 20px; font-size: 12px; color: #999;">
                This is an automated message. Please do not reply to this email.
            </p>
        </div>
    </div>
</body>
</html>
  `,
  
  textBody: `
{{appName}} - Account Recovery Request

Hello {{userName}},

ACCOUNT RECOVERY REQUEST
Someone requested to reset access to your {{appName}} account. This is a secondary recovery method since {{appName}} primarily uses phone number authentication.

If this was you, use the following link to reset your account access:

{{resetUrl}}

This reset link will expire in {{expiryHours}} hours for security reasons.

SECURITY INFORMATION:
- If you didn't request this reset, please ignore this email
- Your account remains secure until you click the reset link  
- Remember: {{appName}} uses phone number as primary authentication
- Contact support if you suspect unauthorized access

Why did I receive this email?
This email was sent because someone requested account recovery for the {{appName}} account associated with this email address. If you have concerns about your account security, please contact our support team immediately.

{{appName}} Team
Need help? Contact us at {{supportEmail}}
Visit our website: {{websiteUrl}}

This is an automated message. Please do not reply to this email.
  `
};

// Generate reset password template data
export const generateResetPasswordTemplateData = (
  resetToken: string,
  userName: string,
  phoneNumber?: string
): ResetPasswordTemplateData => ({
  resetUrl: `${APP_CONFIG.WEBSITE}/reset-password?token=${resetToken}`,
  userName: userName || 'User',
  appName: APP_CONFIG.NAME,
  supportEmail: APP_CONFIG.SUPPORT_EMAIL,
  websiteUrl: APP_CONFIG.WEBSITE,
  expiryHours: '24', // 24 hours expiry
  phoneNumber
});