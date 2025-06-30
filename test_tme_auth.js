/**
 * TME API Authentication Test
 * Tests TME API with correct credentials and signature generation
 */

const crypto = require('crypto');

// TME Credentials from user
const credentials = {
  token: "05bb5ef39f7b451aad7892c53e39db484ca8dd25693a599f96",
  customerNumber: "40071812",
  contactNumber: "676772",
  applicationSecret: "670056035f042574c976"
};

function generateApiSignature(method, url, params) {
  // TME requires precise signature calculation
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  
  console.log('🔐 Signature generation:');
  console.log('- Base string:', baseString);
  console.log('- Application Secret:', credentials.applicationSecret);
  
  const signature = crypto
    .createHmac('sha1', credentials.applicationSecret)
    .update(baseString)
    .digest('base64');
    
  console.log('- Generated signature:', signature);
  return signature;
}

async function testTMEAuthentication() {
  try {
    console.log('🧪 Testing TME API Authentication');
    console.log('📋 Using credentials:');
    console.log('- Token (first 20):', credentials.token.substring(0, 20) + '...');
    console.log('- Customer Number:', credentials.customerNumber);
    console.log('- Contact Number:', credentials.contactNumber);
    console.log('- App Secret (first 10):', credentials.applicationSecret.substring(0, 10) + '...');

    const url = "https://api.tme.eu/Utils/GetTimeLeft.json";
    const params = {
      Token: credentials.token,
      ApiSignature: "",
      Country: "EN"
    };

    // Generate signature
    const signature = generateApiSignature('POST', url, params);
    params.ApiSignature = signature;

    console.log('\n🌐 Making request to TME API...');
    
    const formData = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      formData.append(key, value);
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "CRM-TME-Integration/1.0",
      },
      body: formData.toString(),
    });

    console.log('📡 Response status:', response.status, response.statusText);
    
    const responseText = await response.text();
    console.log('📄 Response body:', responseText);

    if (response.ok) {
      try {
        const data = JSON.parse(responseText);
        console.log('✅ Authentication SUCCESS!');
        console.log('📊 Response data:', JSON.stringify(data, null, 2));
        return { success: true, data };
      } catch (parseError) {
        console.log('❌ Failed to parse JSON response');
        return { success: false, error: 'Invalid JSON response' };
      }
    } else {
      console.log('❌ Authentication FAILED');
      return { success: false, error: `HTTP ${response.status}: ${responseText}` };
    }

  } catch (error) {
    console.error('💥 Error during authentication test:', error);
    return { success: false, error: error.message };
  }
}

// Run the test
testTMEAuthentication().then(result => {
  console.log('\n🏁 Final result:', result);
  if (!result.success) {
    console.log('\n💡 Troubleshooting suggestions:');
    console.log('1. Verify TME token is active and has not expired');
    console.log('2. Check if customer/contact numbers are correct');
    console.log('3. Ensure application secret matches TME dashboard');
    console.log('4. Confirm API signature generation method is correct');
  }
});