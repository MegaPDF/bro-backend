import { APP_CONFIG, OTP_CONFIG } from '@/lib/utils/constants';

export interface OTPTemplateData {
  otp: string;
  expiryMinutes: string;
  userName: string;
  appName: string;
  supportEmail: string;
  phoneNumber?: string;
  isBackup?: boolean;
}

export const otpEmailTemplate = {
  subject: 'Your {{appName}} Verification Code',
  
  htmlBody: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Verification Code</title>
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
            background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
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
        .backup-notice {
            background-color: #e8f4f8;
            border-left: 4px solid #17a2b8;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
            font-size: 14px;
        }
        .otp-container {
            background-color: #f8f9fa;
            border: 2px dashed #25D366;
            border-radius: 8px;
            padding: 30px;
            text-align: center;
            margin: 30px 0;
        }
        .otp-code {
            font-size: 36px;
            font-weight: bold;
            color: #25D366;
            letter-spacing: 8px;
            font-family: 'Courier New', monospace;
            margin: 10px 0;
        }
        .otp-label {
            font-size: 14px;
            color: #666;
            margin-bottom: 10px;
        }
        .expiry-notice {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 6px;
            padding: 15px;
            margin: 20px 0;
            color: #856404;
            font-size: 14px;
            text-align: center;
        }
        .security-note {
            background-color: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 6px;
            padding: 15px;
            margin: 20px 0;
            color: #721c24;
            font-size: 14px;
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
            color: #25D366;
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
            .otp-code {
                font-size: 28px;
                letter-spacing: 4px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="icon">📧</div>
            <h1>{{appName}}</h1>
        </div>
        
        <div class="content">
            <div class="greeting">
                Hello {{userName}},
            </div>
            
            <div class="backup-notice">
                <strong>Email Verification</strong><br>
                We're sending this verification code to your email as a backup method for your {{appName}} account.
            </div>
            
            <p>Use the verification code below to verify your email address:</p>
            
            <div class="otp-container">
                <div class="otp-label">Your Email Verification Code</div>
                <div class="otp-code">{{otp}}</div>
            </div>
            
            <div class="expiry-notice">
                ⏰ This code will expire in {{expiryMinutes}} minutes
            </div>
            
            <p><strong>How to use this code:</strong></p>
            <ol>
                <li>Return to the {{appName}} app</li>
                <li>Enter the 6-digit code shown above</li>
                <li>Complete your email verification</li>
            </ol>
            
            <div class="security-note">
                🔒 <strong>Security Notice:</strong> Never share this code with anyone. {{appName}} will never ask you for this code via phone or text message.
            </div>
            
            <p style="color: #666; font-size: 14px;">
                If you didn't request this verification code, please ignore this email or contact our support team if you have concerns about your account security.
            </p>
        </div>
        
        <div class="footer">
            <p><strong>{{appName}} Team</strong></p>
            <p>Need help? Contact us at <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p>
            <p style="margin-top: 20px; font-size: 12px; color: #999;">
                This is an automated message. Please do not reply to this email.
            </p>
        </div>
    </div>
</body>
</html>
  `,
  
  textBody: `
{{appName}} - Email Verification Code

Hello {{userName}},

EMAIL VERIFICATION
We're sending this verification code to your email as a backup method for your {{appName}} account.

Use the verification code below to verify your email address:

VERIFICATION CODE: {{otp}}

This code will expire in {{expiryMinutes}} minutes.

How to use this code:
1. Return to the {{appName}} app
2. Enter the 6-digit code: {{otp}}
3. Complete your email verification

SECURITY NOTICE: Never share this code with anyone. {{appName}} will never ask you for this code via phone or text message.

If you didn't request this verification code, please ignore this email or contact our support team if you have concerns about your account security.

{{appName}} Team
Need help? Contact us at {{supportEmail}}

This is an automated message. Please do not reply to this email.
  `
};

// Generate OTP template data
export const generateOTPTemplateData = (
  otp: string,
  userName: string,
  phoneNumber?: string
): OTPTemplateData => ({
  otp,
  expiryMinutes: OTP_CONFIG.EXPIRY_MINUTES.toString(),
  userName: userName || 'User',
  appName: APP_CONFIG.NAME,
  supportEmail: APP_CONFIG.SUPPORT_EMAIL,
  phoneNumber,
  isBackup: true
});