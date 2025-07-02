import { APP_CONFIG } from '@/lib/utils/constants';

export interface WelcomeTemplateData {
  userName: string;
  appName: string;
  supportEmail: string;
  websiteUrl: string;
  phoneNumber: string;
  joinDate: string;
  downloadLinks?: {
    android?: string;
    ios?: string;
  };
}

export const welcomeEmailTemplate = {
  subject: 'Welcome to {{appName}}! 🎉',
  
  htmlBody: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to {{appName}}</title>
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
            padding: 50px 20px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 32px;
            font-weight: 600;
        }
        .header .icon {
            font-size: 64px;
            margin-bottom: 20px;
        }
        .header .subtitle {
            font-size: 18px;
            opacity: 0.9;
            margin-top: 10px;
        }
        .content {
            padding: 40px 30px;
        }
        .greeting {
            font-size: 24px;
            margin-bottom: 20px;
            color: #2c3e50;
            text-align: center;
        }
        .welcome-message {
            background: linear-gradient(135deg, #e8f5e8 0%, #f0f9f0 100%);
            border-radius: 8px;
            padding: 30px;
            margin: 30px 0;
            text-align: center;
        }
        .account-info {
            background-color: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        .account-info h3 {
            margin-top: 0;
            color: #25D366;
        }
        .account-info .info-item {
            display: flex;
            justify-content: space-between;
            margin: 10px 0;
            padding: 8px 0;
            border-bottom: 1px solid #e9ecef;
        }
        .account-info .info-item:last-child {
            border-bottom: none;
        }
        .features-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin: 30px 0;
        }
        .feature-item {
            background-color: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
        }
        .feature-item .icon {
            font-size: 32px;
            margin-bottom: 10px;
        }
        .feature-item h4 {
            margin: 10px 0 5px 0;
            color: #2c3e50;
            font-size: 16px;
        }
        .feature-item p {
            margin: 0;
            font-size: 14px;
            color: #666;
        }
        .download-section {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 8px;
            padding: 30px;
            margin: 30px 0;
            text-align: center;
        }
        .download-buttons {
            display: flex;
            justify-content: center;
            gap: 15px;
            margin-top: 20px;
        }
        .download-btn {
            display: inline-block;
            background-color: rgba(255, 255, 255, 0.1);
            color: white !important;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            border: 2px solid rgba(255, 255, 255, 0.3);
            transition: all 0.3s ease;
        }
        .download-btn:hover {
            background-color: rgba(255, 255, 255, 0.2);
            border-color: rgba(255, 255, 255, 0.5);
        }
        .tips-section {
            background-color: #e8f4f8;
            border-left: 4px solid #17a2b8;
            padding: 20px;
            margin: 20px 0;
            border-radius: 4px;
        }
        .tips-section h3 {
            margin-top: 0;
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
            .features-grid {
                grid-template-columns: 1fr;
            }
            .download-buttons {
                flex-direction: column;
                align-items: center;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="icon">🎉</div>
            <h1>Welcome to {{appName}}!</h1>
            <div class="subtitle">Your secure messaging journey starts here</div>
        </div>
        
        <div class="content">
            <div class="greeting">
                Hello {{userName}}! 👋
            </div>
            
            <div class="welcome-message">
                <h2 style="margin-top: 0; color: #25D366;">Thank you for joining {{appName}}!</h2>
                <p style="font-size: 16px; margin-bottom: 0;">
                    You've successfully registered your account using your phone number. 
                    We're excited to have you as part of our secure messaging community!
                </p>
            </div>
            
            <div class="account-info">
                <h3>📱 Your Account Information</h3>
                <div class="info-item">
                    <span><strong>Phone Number:</strong></span>
                    <span>{{phoneNumber}}</span>
                </div>
                <div class="info-item">
                    <span><strong>Display Name:</strong></span>
                    <span>{{userName}}</span>
                </div>
                <div class="info-item">
                    <span><strong>Joined:</strong></span>
                    <span>{{joinDate}}</span>
                </div>
                <div class="info-item">
                    <span><strong>Account Status:</strong></span>
                    <span style="color: #25D366; font-weight: 600;">✅ Verified</span>
                </div>
            </div>
            
            <div class="features-grid">
                <div class="feature-item">
                    <div class="icon">💬</div>
                    <h4>Secure Messaging</h4>
                    <p>End-to-end encrypted messages for privacy</p>
                </div>
                <div class="feature-item">
                    <div class="icon">📞</div>
                    <h4>Voice & Video Calls</h4>
                    <p>Crystal clear calls with your contacts</p>
                </div>
                <div class="feature-item">
                    <div class="icon">👥</div>
                    <h4>Group Chats</h4>
                    <p>Stay connected with family and friends</p>
                </div>
                <div class="feature-item">
                    <div class="icon">📸</div>
                    <h4>Status Updates</h4>
                    <p>Share moments with disappearing stories</p>
                </div>
            </div>
            
            <div class="download-section">
                <h3 style="margin-top: 0;">📱 Get the Mobile App</h3>
                <p>Download the {{appName}} mobile app for the best experience on your phone.</p>
                <div class="download-buttons">
                    <a href="#" class="download-btn">📱 Download for iOS</a>
                    <a href="#" class="download-btn">🤖 Download for Android</a>
                </div>
            </div>
            
            <div class="tips-section">
                <h3>💡 Getting Started Tips</h3>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li><strong>Add Contacts:</strong> Import your phone contacts to find friends already on {{appName}}</li>
                    <li><strong>Profile Setup:</strong> Add a profile picture and status message</li>
                    <li><strong>Privacy Settings:</strong> Customize who can see your info and status</li>
                    <li><strong>Backup:</strong> Enable chat backup to keep your messages safe</li>
                </ul>
            </div>
            
            <p style="text-align: center; font-size: 16px; margin: 30px 0;">
                <strong>Need help getting started?</strong><br>
                Our support team is here to help you every step of the way.
            </p>
        </div>
        
        <div class="footer">
            <p><strong>{{appName}} Team</strong></p>
            <p>Need help? Contact us at <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p>
            <p>Visit our website: <a href="{{websiteUrl}}">{{websiteUrl}}</a></p>
            <p style="margin-top: 20px; font-size: 12px; color: #999;">
                This is an automated welcome message. Please do not reply to this email.
            </p>
        </div>
    </div>
</body>
</html>
  `,
  
  textBody: `
Welcome to {{appName}}! 🎉

Hello {{userName}}!

Thank you for joining {{appName}}! You've successfully registered your account using your phone number. We're excited to have you as part of our secure messaging community!

YOUR ACCOUNT INFORMATION:
- Phone Number: {{phoneNumber}}
- Display Name: {{userName}}
- Joined: {{joinDate}}
- Account Status: ✅ Verified

FEATURES YOU CAN ENJOY:
💬 Secure Messaging - End-to-end encrypted messages for privacy
📞 Voice & Video Calls - Crystal clear calls with your contacts  
👥 Group Chats - Stay connected with family and friends
📸 Status Updates - Share moments with disappearing stories

GETTING STARTED TIPS:
- Add Contacts: Import your phone contacts to find friends already on {{appName}}
- Profile Setup: Add a profile picture and status message
- Privacy Settings: Customize who can see your info and status
- Backup: Enable chat backup to keep your messages safe

Download the {{appName}} mobile app for the best experience on your phone.

Need help getting started? Our support team is here to help you every step of the way.

{{appName}} Team
Need help? Contact us at {{supportEmail}}
Visit our website: {{websiteUrl}}

This is an automated welcome message. Please do not reply to this email.
  `
};

// Generate welcome template data
export const generateWelcomeTemplateData = (
  userName: string,
  phoneNumber: string,
  additionalData?: Record<string, any>
): WelcomeTemplateData => ({
  userName: userName || 'User',
  appName: APP_CONFIG.NAME,
  supportEmail: APP_CONFIG.SUPPORT_EMAIL,
  websiteUrl: APP_CONFIG.WEBSITE,
  phoneNumber,
  joinDate: new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  }),
  downloadLinks: {
    android: additionalData?.androidAppUrl || '#',
    ios: additionalData?.iosAppUrl || '#'
  }
});