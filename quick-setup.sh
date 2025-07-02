#!/bin/bash

# ==============================================
# WhatsApp Clone - Implementation Guide
# ==============================================
# This guide shows the exact order to implement endpoints
# to get a fully working authentication system

echo "🚀 WhatsApp Clone Authentication Implementation Guide"
echo "=================================================="

echo "
📋 CURRENT STATUS:
✅ Send OTP (/api/auth/send-otp)
✅ Verify OTP (/api/auth/verify-otp)  
✅ Twilio SMS Integration
✅ Environment Configuration
✅ Database Models
✅ Validation Schemas

🎯 NEXT STEPS - Implementation Order:
"

echo "
STEP 1: Core JWT Service (HIGHEST PRIORITY)
==========================================
Files to create/update:

1.1. Enhance JWT Service
📁 src/lib/auth/jwt.ts
   - Add generateTokenPair() method
   - Add refreshTokenPair() method
   - Add invalidateRefreshTokensForDevice() method
   - Add token storage/retrieval logic

1.2. Test JWT functionality
   - Generate tokens after OTP verification
   - Test token validation
   - Test token refresh
"

echo "
STEP 2: Login Endpoint (HIGH PRIORITY)
=====================================
Files to create:

2.1. Login Route
📁 app/api/auth/login/route.ts
   - Verify OTP + device info
   - Find existing user
   - Generate JWT tokens
   - Update device info
   - Return tokens + user info

2.2. Test login flow
   curl -X POST 'http://localhost:3000/api/auth/login' \\
     -H 'Content-Type: application/json' \\
     -d '{
       \"phoneNumber\": \"+1234567890\",
       \"countryCode\": \"+1\",
       \"otp\": \"123456\",
       \"deviceInfo\": {
         \"deviceId\": \"test-device\",
         \"deviceName\": \"Test Device\",
         \"platform\": \"test\",
         \"appVersion\": \"1.0.0\"
       }
     }'
"

echo "
STEP 3: Token Refresh (HIGH PRIORITY)
====================================
Files to create:

3.1. Refresh Route
📁 app/api/auth/refresh/route.ts
   - Validate refresh token
   - Generate new access token
   - Optionally rotate refresh token
   - Return new token pair

3.2. Test token refresh
   curl -X POST 'http://localhost:3000/api/auth/refresh' \\
     -H 'Content-Type: application/json' \\
     -d '{\"refreshToken\": \"your-refresh-token\"}'
"

echo "
STEP 4: Current User Info (MEDIUM PRIORITY)
==========================================
Files to create:

4.1. Me Route
📁 app/api/auth/me/route.ts
   - Use auth middleware
   - Return current user info
   - Include device info

4.2. Test authenticated request
   curl -X GET 'http://localhost:3000/api/auth/me' \\
     -H 'Authorization: Bearer your-access-token'
"

echo "
STEP 5: User Profile Management (MEDIUM PRIORITY)
================================================
Files to create:

5.1. Profile Routes
📁 app/api/user/profile/route.ts
   - GET: Retrieve user profile
   - PUT: Update user profile
   - Use withAuth middleware

5.2. Test profile operations
   # Get profile
   curl -X GET 'http://localhost:3000/api/user/profile' \\
     -H 'Authorization: Bearer your-access-token'
   
   # Update profile
   curl -X PUT 'http://localhost:3000/api/user/profile' \\
     -H 'Authorization: Bearer your-access-token' \\
     -d '{\"displayName\": \"Updated Name\"}'
"

echo "
STEP 6: Logout (MEDIUM PRIORITY)
===============================
Files to create:

6.1. Logout Route
📁 app/api/auth/logout/route.ts
   - Invalidate access token
   - Remove refresh token
   - Update device status
   - Set user offline if no devices

6.2. Test logout
   curl -X POST 'http://localhost:3000/api/auth/logout' \\
     -H 'Authorization: Bearer your-access-token' \\
     -d '{\"deviceId\": \"test-device\"}'
"

echo "
STEP 7: Registration Completion (LOW PRIORITY)
=============================================
Files to create:

7.1. Complete Registration Route
📁 app/api/auth/register/complete/route.ts
   - Complete user profile after OTP
   - Generate tokens
   - Add device info

7.2. Device Management
📁 app/api/user/devices/route.ts
   - GET: List user devices
   - PUT: Update device info
   - DELETE: Remove device
"

echo "
STEP 8: Health Checks & Monitoring (LOW PRIORITY)
================================================
Files to create:

8.1. Health Check Routes
📁 app/api/health/route.ts
📁 app/api/health/db/route.ts
📁 app/api/health/email/route.ts

8.2. Test health checks
   curl -X GET 'http://localhost:3000/api/health'
"

echo "
🔧 IMPLEMENTATION COMMANDS:
========================

# 1. Create directory structure
mkdir -p app/api/auth/{login,refresh,me,logout}
mkdir -p app/api/user/{profile,devices}
mkdir -p app/api/health

# 2. Install additional dependencies
npm install @types/jsonwebtoken

# 3. Update User model if needed
# Add device management fields
# Add proper indexes

# 4. Enhance middleware
# Update authMiddleware for device validation
# Add rate limiting
# Add request logging

# 5. Test each endpoint as you implement
# Use the complete cURL test script
# Test error scenarios
# Test edge cases
"

echo "
📱 TESTING CHECKLIST:
===================

For each endpoint implementation:

□ Create the endpoint file
□ Add proper validation
□ Add error handling
□ Add analytics tracking
□ Test with cURL
□ Test error scenarios
□ Update cURL test script
□ Document the endpoint

Authentication Flow Testing:
□ Send OTP (existing ✅)
□ Verify OTP (existing ✅)  
□ Login with tokens
□ Use authenticated endpoints
□ Refresh expired tokens
□ Logout and invalidate tokens
□ Test after logout (should fail)
"

echo "
🚨 CRITICAL SECURITY REMINDERS:
=============================

1. JWT Secrets:
   - Use strong, random secrets
   - Different secrets for access/refresh tokens
   - Store securely in environment variables

2. Token Expiry:
   - Short-lived access tokens (15-60 minutes)
   - Longer-lived refresh tokens (7-30 days)
   - Implement automatic refresh

3. Device Management:
   - Limit devices per user
   - Track device info
   - Allow device revocation

4. Rate Limiting:
   - Limit OTP requests
   - Limit login attempts
   - Limit token refresh requests

5. Audit Logging:
   - Log all authentication events
   - Track failed attempts
   - Monitor suspicious activity
"

echo "
🎯 SUCCESS CRITERIA:
==================

Your authentication system is complete when:

✅ Users can register with phone + OTP
✅ Users can login with phone + OTP
✅ JWT tokens are properly generated
✅ Tokens can be refreshed
✅ Users can access protected endpoints
✅ Users can update their profile
✅ Users can logout and invalidate tokens
✅ Failed requests return proper errors
✅ Rate limiting prevents abuse
✅ All endpoints are documented
✅ Complete cURL test passes 100%

📈 NEXT PHASE - WhatsApp Features:
=================================
After authentication is complete:
- Contacts management
- Chat creation and management
- Real-time messaging
- File uploads and media
- Voice/video calls
- Status updates
- Groups and broadcasts
"

echo "
🚀 Quick Start Implementation:

1. Copy the missing endpoint code
2. Create the JWT token methods
3. Test with the complete cURL script
4. Implement endpoints in priority order
5. Test each endpoint as you build it

Good luck building your WhatsApp clone! 🎉
"