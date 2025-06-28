# TME API Activation Guide

## Current Status
Your TME API credentials are properly configured in the system:
- ✅ API Token: Configured (50 characters)
- ✅ Customer Number: 676772
- ✅ Contact Number: 40071812

## Issue Identified
The TME API returns error code 101000: "Request forbidden by administrative rules"
This indicates your API key requires activation or additional permissions.

## Steps to Activate TME API Access

### 1. Contact TME Support
**Email**: api@tme.eu
**Subject**: API Key Activation Request - Customer #676772

**Message Template**:
```
Dear TME API Support,

I am requesting activation of API access for my account.

Account Details:
- Customer Number: 676772
- Contact Number: 40071812
- API Token: [Your token - e49629aa0ff9bfc91946a4ef9f62f604ea9397df27472bcd3b]

I need access to the following API endpoints:
- Products/Search.json (product search)
- Products/GetCategories.json (category listing)
- Products/GetPrices.json (pricing information)
- Products/GetStock.json (inventory levels)

Purpose: Integration with inventory management system for automated product synchronization.

Please activate my API access or advise on any additional requirements.

Best regards,
[Your name]
```

### 2. Required API Permissions
Request activation for these specific endpoints:
- **Product Search**: For finding electronics components
- **Product Details**: For retrieving specifications
- **Pricing Data**: For cost calculations
- **Stock Information**: For inventory management

### 3. Alternative Contact Methods
- **Phone**: Check your TME account dashboard for support phone numbers
- **Account Manager**: If you have a dedicated account manager, contact them directly
- **Online Portal**: Log into your TME account and submit a support ticket

### 4. Expected Timeline
- Response time: 1-3 business days
- Activation: Usually within 24 hours after approval

### 5. Testing After Activation
Once activated, test the integration using the TME Sync page in your CRM:
1. Navigate to TME Sync page
2. Try syncing with a simple search term (e.g., "resistor")
3. Check sync logs for successful API responses

## Current Error Handling
The system is configured to handle API restrictions gracefully:
- Clear error messages for users
- Detailed logging for troubleshooting
- Fallback messaging when API is unavailable

Your CRM will automatically work once TME activates your API access.