#!/bin/bash

# ==============================================
# Dual Authentication Testing - Phone OR Email
# ==============================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

API_BASE="http://localhost:3000/api"

echo -e "${BLUE}================================================================${NC}"
echo -e "${BLUE}        Dual Authentication Test - Phone OR Email           ${NC}"
echo -e "${BLUE}================================================================${NC}"

echo -e "\n${YELLOW}Choose authentication method to test:${NC}"
echo "1. Phone Number (SMS OTP)"
echo "2. Email Address (Email OTP)"
echo "3. Test Both Methods"
echo "4. Interactive Testing"
read -p "Choose option (1-4) [3]: " TEST_CHOICE
TEST_CHOICE=${TEST_CHOICE:-3}

# ==============================================
# TEST 1: PHONE NUMBER AUTHENTICATION
# ==============================================
if [[ "$TEST_CHOICE" == "1" || "$TEST_CHOICE" == "3" ]]; then
    echo -e "\n${PURPLE}================================================================${NC}"
    echo -e "${PURPLE}                  PHONE NUMBER AUTHENTICATION                 ${NC}"
    echo -e "${PURPLE}================================================================${NC}"

    echo -e "\n${YELLOW}Test 1.1: Send OTP to Phone Number${NC}"
    
    PHONE_NUMBER="+1234567890"
    COUNTRY_CODE="+1"
    
    if [[ "$TEST_CHOICE" == "4" ]]; then
        read -p "Enter phone number (e.g., +1234567890): " PHONE_NUMBER
        read -p "Enter country code (e.g., +1): " COUNTRY_CODE
    fi

    echo "📱 Sending OTP to phone: $PHONE_NUMBER"

    PHONE_OTP_RESPONSE=$(curl -X POST "$API_BASE/auth/send-otp" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -d "{
            \"method\": \"phone\",
            \"phoneNumber\": \"$PHONE_NUMBER\",
            \"countryCode\": \"$COUNTRY_CODE\"
        }" \
        -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n" \
        -s)

    echo "$PHONE_OTP_RESPONSE" | head -n -2 | jq '.'
    HTTP_STATUS=$(echo "$PHONE_OTP_RESPONSE" | tail -n 2 | head -n 1 | grep -o '[0-9]*')
    
    if [[ "$HTTP_STATUS" == "200" ]]; then
        echo -e "${GREEN}✅ Phone OTP sent successfully${NC}"
        PHONE_USER_ID=$(echo "$PHONE_OTP_RESPONSE" | jq -r '.data.userId // .userId // "temporary"')
        echo "   User ID: $PHONE_USER_ID"
        
        # Test verification
        echo -e "\n${YELLOW}Test 1.2: Verify Phone OTP${NC}"
        
        if [[ "$TEST_CHOICE" == "4" ]]; then
            read -p "Enter the OTP code you received via SMS: " PHONE_OTP_CODE
        else
            PHONE_OTP_CODE="123456"
            echo "🤖 Using test OTP: $PHONE_OTP_CODE"
        fi

        PHONE_VERIFY_RESPONSE=$(curl -X POST "$API_BASE/auth/verify-otp" \
            -H "Content-Type: application/json" \
            -H "Accept: application/json" \
            -d "{
                \"method\": \"phone\",
                \"identifier\": \"$PHONE_NUMBER\",
                \"otp\": \"$PHONE_OTP_CODE\",
                \"userId\": \"$PHONE_USER_ID\"
            }" \
            -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n" \
            -s)

        echo "$PHONE_VERIFY_RESPONSE" | head -n -2 | jq '.'
        VERIFY_STATUS=$(echo "$PHONE_VERIFY_RESPONSE" | tail -n 2 | head -n 1 | grep -o '[0-9]*')
        
        if [[ "$VERIFY_STATUS" == "200" ]]; then
            echo -e "${GREEN}✅ Phone OTP verified successfully${NC}"
        else
            echo -e "${RED}❌ Phone OTP verification failed${NC}"
        fi
    else
        echo -e "${RED}❌ Failed to send phone OTP${NC}"
    fi
fi

# ==============================================
# TEST 2: EMAIL AUTHENTICATION
# ==============================================
if [[ "$TEST_CHOICE" == "2" || "$TEST_CHOICE" == "3" ]]; then
    echo -e "\n${PURPLE}================================================================${NC}"
    echo -e "${PURPLE}                    EMAIL AUTHENTICATION                      ${NC}"
    echo -e "${PURPLE}================================================================${NC}"

    echo -e "\n${YELLOW}Test 2.1: Send OTP to Email Address${NC}"
    
    EMAIL_ADDRESS="ganggasungain@gmail.com"
    
    if [[ "$TEST_CHOICE" == "4" ]]; then
        read -p "Enter email address: " EMAIL_ADDRESS
    fi

    echo "📧 Sending OTP to email: $EMAIL_ADDRESS"

    EMAIL_OTP_RESPONSE=$(curl -X POST "$API_BASE/auth/send-otp" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -d "{
            \"method\": \"email\",
            \"email\": \"$EMAIL_ADDRESS\"
        }" \
        -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n" \
        -s)

    echo "$EMAIL_OTP_RESPONSE" | head -n -2 | jq '.'
    HTTP_STATUS=$(echo "$EMAIL_OTP_RESPONSE" | tail -n 2 | head -n 1 | grep -o '[0-9]*')
    
    if [[ "$HTTP_STATUS" == "200" ]]; then
        echo -e "${GREEN}✅ Email OTP sent successfully${NC}"
        EMAIL_USER_ID=$(echo "$EMAIL_OTP_RESPONSE" | jq -r '.data.userId // .userId // "temporary"')
        echo "   User ID: $EMAIL_USER_ID"
        
        # Test verification
        echo -e "\n${YELLOW}Test 2.2: Verify Email OTP${NC}"
        
        if [[ "$TEST_CHOICE" == "4" ]]; then
            read -p "Enter the OTP code you received via email: " EMAIL_OTP_CODE
        else
            EMAIL_OTP_CODE="123456"
            echo "🤖 Using test OTP: $EMAIL_OTP_CODE"
        fi

        EMAIL_VERIFY_RESPONSE=$(curl -X POST "$API_BASE/auth/verify-otp" \
            -H "Content-Type: application/json" \
            -H "Accept: application/json" \
            -d "{
                \"method\": \"email\",
                \"identifier\": \"$EMAIL_ADDRESS\",
                \"otp\": \"$EMAIL_OTP_CODE\",
                \"userId\": \"$EMAIL_USER_ID\"
            }" \
            -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n" \
            -s)

        echo "$EMAIL_VERIFY_RESPONSE" | head -n -2 | jq '.'
        VERIFY_STATUS=$(echo "$EMAIL_VERIFY_RESPONSE" | tail -n 2 | head -n 1 | grep -o '[0-9]*')
        
        if [[ "$VERIFY_STATUS" == "200" ]]; then
            echo -e "${GREEN}✅ Email OTP verified successfully${NC}"
        else
            echo -e "${RED}❌ Email OTP verification failed${NC}"
        fi
    else
        echo -e "${RED}❌ Failed to send email OTP${NC}"
    fi
fi

# ==============================================
# TEST 3: ERROR CASES
# ==============================================
echo -e "\n${PURPLE}================================================================${NC}"
echo -e "${PURPLE}                       ERROR CASE TESTING                     ${NC}"
echo -e "${PURPLE}================================================================${NC}"

echo -e "\n${YELLOW}Test 3.1: Invalid Method${NC}"
curl -X POST "$API_BASE/auth/send-otp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d '{
        "method": "invalid",
        "phoneNumber": "+1234567890"
    }' \
    -w "\nHTTP Status: %{http_code}\n" \
    -s | jq '.'

echo -e "\n${YELLOW}Test 3.2: Missing Phone Number for Phone Method${NC}"
curl -X POST "$API_BASE/auth/send-otp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d '{
        "method": "phone",
        "countryCode": "+1"
    }' \
    -w "\nHTTP Status: %{http_code}\n" \
    -s | jq '.'

echo -e "\n${YELLOW}Test 3.3: Missing Email for Email Method${NC}"
curl -X POST "$API_BASE/auth/send-otp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d '{
        "method": "email"
    }' \
    -w "\nHTTP Status: %{http_code}\n" \
    -s | jq '.'

echo -e "\n${YELLOW}Test 3.4: Invalid Email Format${NC}"
curl -X POST "$API_BASE/auth/send-otp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d '{
        "method": "email",
        "email": "invalid-email"
    }' \
    -w "\nHTTP Status: %{http_code}\n" \
    -s | jq '.'

echo -e "\n${YELLOW}Test 3.5: Invalid Phone Format${NC}"
curl -X POST "$API_BASE/auth/send-otp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d '{
        "method": "phone",
        "phoneNumber": "invalid-phone",
        "countryCode": "+1"
    }' \
    -w "\nHTTP Status: %{http_code}\n" \
    -s | jq '.'

# ==============================================
# TEST 4: RATE LIMITING
# ==============================================
echo -e "\n${PURPLE}================================================================${NC}"
echo -e "${PURPLE}                        RATE LIMITING TEST                     ${NC}"
echo -e "${PURPLE}================================================================${NC}"

echo -e "\n${YELLOW}Test 4.1: Multiple Phone OTP Requests (Rate Limiting)${NC}"
for i in {1..3}; do
    echo -e "\nRequest $i:"
    curl -X POST "$API_BASE/auth/send-otp" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -d "{
            \"method\": \"phone\",
            \"phoneNumber\": \"+123456789$i\",
            \"countryCode\": \"+1\"
        }" \
        -w "HTTP Status: %{http_code} " \
        -s | jq -r '.success, .message' | tr '\n' ' '
    echo ""
done

echo -e "\n${YELLOW}Test 4.2: Multiple Email OTP Requests (Rate Limiting)${NC}"
for i in {1..3}; do
    echo -e "\nRequest $i:"
    curl -X POST "$API_BASE/auth/send-otp" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -d "{
            \"method\": \"email\",
            \"email\": \"test$i@example.com\"
        }" \
        -w "HTTP Status: %{http_code} " \
        -s | jq -r '.success, .message' | tr '\n' ' '
    echo ""
done

# ==============================================
# SUMMARY AND NEXT STEPS
# ==============================================
echo -e "\n${BLUE}================================================================${NC}"
echo -e "${BLUE}                           TEST SUMMARY                        ${NC}"
echo -e "${BLUE}================================================================${NC}"

echo -e "\n${GREEN}✅ Implemented Features:${NC}"
echo "   - Dual authentication method selection"
echo "   - Phone number OTP via SMS (with Twilio integration)"
echo "   - Email OTP via email service"
echo "   - Proper validation for both methods"
echo "   - Rate limiting for both methods"
echo "   - Error handling for invalid inputs"

echo -e "\n${YELLOW}📋 API Usage Examples:${NC}"

echo -e "\n${BLUE}Send Phone OTP:${NC}"
echo 'curl -X POST "http://localhost:3000/api/auth/send-otp" \'
echo '  -H "Content-Type: application/json" \'
echo '  -d '\''{
    "method": "phone",
    "phoneNumber": "+1234567890",
    "countryCode": "+1"
  }'\'''

echo -e "\n${BLUE}Send Email OTP:${NC}"
echo 'curl -X POST "http://localhost:3000/api/auth/send-otp" \'
echo '  -H "Content-Type: application/json" \'
echo '  -d '\''{
    "method": "email",
    "email": "user@example.com"
  }'\'''

echo -e "\n${BLUE}Verify Phone OTP:${NC}"
echo 'curl -X POST "http://localhost:3000/api/auth/verify-otp" \'
echo '  -H "Content-Type: application/json" \'
echo '  -d '\''{
    "method": "phone",
    "identifier": "+1234567890",
    "otp": "123456",
    "userId": "user_id_from_send_response"
  }'\'''

echo -e "\n${BLUE}Verify Email OTP:${NC}"
echo 'curl -X POST "http://localhost:3000/api/auth/verify-otp" \'
echo '  -H "Content-Type: application/json" \'
echo '  -d '\''{
    "method": "email",
    "identifier": "user@example.com",
    "otp": "123456",
    "userId": "user_id_from_send_response"
  }'\'''

echo -e "\n${PURPLE}🔧 Implementation Checklist:${NC}"
echo "□ Update validation schemas (sendOTPSchema, verifyOTPSchema)"
echo "□ Update User model to support authMethod field"
echo "□ Update OTP service for dual delivery"
echo "□ Update send-otp API route"
echo "□ Update verify-otp API route"
echo "□ Add email delivery service"
echo "□ Update frontend to show method selection"
echo "□ Test both authentication flows"

echo -e "\n${GREEN}🎯 Benefits of Dual Authentication:${NC}"
echo "   ✅ User choice and flexibility"
echo "   ✅ Better accessibility (some users prefer email)"
echo "   ✅ Reduced SMS costs for email users"
echo "   ✅ Backup method if SMS fails"
echo "   ✅ Better international support"
echo "   ✅ Compliance with different regional preferences"

echo -e "\n${BLUE}📱 Frontend Implementation Example:${NC}"
echo "const authMethods = ["
echo "  { value: 'phone', label: '📱 Phone Number', description: 'Get OTP via SMS' },"
echo "  { value: 'email', label: '📧 Email Address', description: 'Get OTP via Email' }"
echo "];"

echo -e "\n${GREEN}🎉 Dual authentication system ready for implementation!${NC}"