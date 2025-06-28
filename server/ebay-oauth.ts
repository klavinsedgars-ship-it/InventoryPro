// eBay OAuth 2.0 Token Management
// Handles access tokens, refresh tokens, and automatic token refresh

interface EbayOAuthToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  expires_at: number; // Calculated timestamp when token expires
}

export class EbayOAuthService {
  private currentToken?: EbayOAuthToken;
  private baseUrl = "https://api.ebay.com";
  private sandboxUrl = "https://api.sandbox.ebay.com";
  private isProduction = true;

  constructor() {
    // Load existing token from environment if available
    this.loadTokenFromEnvironment();
  }

  private loadTokenFromEnvironment() {
    const accessToken = process.env.EBAY_ACCESS_TOKEN;
    const refreshToken = process.env.EBAY_REFRESH_TOKEN;
    const expiresAt = process.env.EBAY_TOKEN_EXPIRES_AT;

    if (accessToken && refreshToken && expiresAt) {
      this.currentToken = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 7200, // Default 2 hours
        token_type: "Bearer",
        expires_at: parseInt(expiresAt)
      };
    } else {
      // Use the fresh OAuth token from eBay Developer Console  
      const ebayUserToken = 'v^1.1#i^1#p^1#I^3#r^0#f^0#t^H4sIAAAAAAAA/+VYbWwURRjutVekYKkKVimalEUFKbs3+3Nt3UrPXCnNnT3a0ru2UiG4H7Ptlr3dzc4sRxFCKUokMQ0NEiL6o0QS4Q+CMZr4gV9R0ZgIMRh/2ChGIiRUJWAIEIm721KulfDVS2zi/bnMzDvvPM8z7zvv7ICeKUULt8a2Xij23ZU/0AN68n0+ejoomlJYMaMgv6wwD2QZ+AZ6Hunx9xacWoyEtGbyzRCZho5g+bq0piPe66wmbEvnDQGpiNeFNEQ8lvhkdFmCZyjAm5aBDcnQiPJ4bTUhCzSnSHIQCIrMySHg9OpXfaaMaoKRw6zIVLFQ4GRWFFlnHCEbxnWEBR0744AJkqCSZEIphuEBxwOWYqrC7UR5K7SQauiOCQWIiAeX9+ZaWVhvDFVACFrYcUJE4tG6ZGM0Xru0IbU4kOUrMqJDEgvYRmNbSwwZlrcKmg1vvAzyrPmkLUkQISIQGV5hrFM+ehXMHcD3pGalYJVCA45zJIfBsJgTKesMKy3gG+Nwe1SZVDxTHupYxd03U9RRQ+yCEh5pNTgu4rXl7t9yW9BURYVWNbG0Jroi2tREROoFS1NRq0rW2ZqmGmRTcy0py5yghKo4QNLBEAM4NjyyzLCvEZHHrbPE0GXVlQyVNxi4BjqY4VhlaD6YpYxj1Kg3WlEFu3hG7cIpAEYVpNvdLR3eQxt36u6uwrQjQ7nXvLn+o7MxtlTRxnDUw/gBT6BqQjBNVSbGD3qROBI861A10YmxyQcCmUyGyrCUYXUEGADowNPLEkmpE6YFwrN1c921V28+gVQ9KhJ0ZiKVx92mg2WdE6kOAL2DiHAsywXZEd3HwoqM7/1XRxbnwNh8yFV+QI5hZLqSUVgnaiRWykV+REZCNODigKLQTaYFaw3EpiZIkJScOLPT0FJlng0qDBtSIClXhhWSCysKKQblSpJWIAQQiqIUDv1/0uRWAz0JJQviHEV6rqK8uULqigmdzWaqbX2LiiqCLR2MXq8n7Bis4KT1tTXR9V3BTNKKRatvNReuS36JpjrKpJz1cyWAm+u5ESFmIAzlCdFLSoYJmwxNlbon1wazltwkWLg7CZ0k0jsmRDJqmvFcndQ5ondbh8Sdsc5lffpPatN1WSE3YCcXK3c+chwIpkq51YeSjHTAEJxrR8DNdad7tYd6QrxV5846qVg7JIfZqvLwZZPyKFNorURZEBm25dyzqUb39pUy1kDdqWbYMjQNWq30hLM5nbaxIGpwsqV1DgJcFSZZqaWrgjTNhRhuYrwkr5CunmxHUu4OYv+Tt3mhDoz9uI/keT+61/cp6PUdzvf5wGLwKD0PzJ1S0OIvuLsMqRhSqqBQSO3QnW9WC1JrYLcpqFb+zLxvZyTkzbHEXz2i/W7b+SdDecVZbwsDq8CDo68LRQX09KynBvDQtZFCuuSBYiYIKpkQ4/AGbDuYd23UT5f6Z8ENBa33Th3c8OyPc7d8k9yHi+o+HADFo0Y+X2Gev9eXt9+f+f3LhL37h2n7r/RXvHLmjTOFWqbq4gWiyCjLHBlKhNpf35h6Z9XzLy76JbbrhHlsztC2wpk7jrXtjJdktvx8/6EoNbht6PScTc+tME62PM7gwbpT8djnR565fPTgkLJoWj0Qj3/33qWVK586j8tmDw2Kmy627i09d+XAa3v72jb/ee7wgo7d2vYdqeP5r37f9zWdKHn5Pu5g529/pz9+85PtNUd7thTAUnyqryZ8sm3H/OVHpr509p4v3ir+6MohdvWv+2fNu1y/6uzaGSX2UMgg5/efe0I/sVOkpratLPmgoX/jZyfIeOOZlPLH2+bJPUUvlAYWPLbr0qH3Z4uzL3z18MKf9vSdPtC/b3gv/wEvRPQN9REAAA==';
      this.currentToken = {
        access_token: ebayUserToken,
        refresh_token: '', // OAuth tokens don't have separate refresh tokens
        expires_in: 7200, // 2 hours typical for OAuth tokens
        token_type: 'Bearer',
        expires_at: Date.now() + (7200 * 1000)
      };
    }
  }

  private getApiUrl(): string {
    return this.isProduction ? this.baseUrl : this.sandboxUrl;
  }

  private isTokenValid(): boolean {
    if (!this.currentToken) return false;
    
    // Check if token expires in the next 5 minutes (300 seconds buffer)
    const now = Math.floor(Date.now() / 1000);
    return this.currentToken.expires_at > (now + 300);
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  async getValidAccessToken(): Promise<string> {
    if (this.currentToken && this.isTokenValid()) {
      return this.currentToken.access_token;
    }

    if (this.currentToken?.refresh_token) {
      await this.refreshAccessToken();
      return this.currentToken!.access_token;
    }

    throw new Error("No valid refresh token available. Please re-authorize the application.");
  }

  /**
   * Exchange authorization code for initial tokens (first-time setup)
   */
  async exchangeCodeForTokens(authorizationCode: string): Promise<EbayOAuthToken> {
    const credentials = Buffer.from(`${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`).toString('base64');
    
    const response = await fetch(`${this.getApiUrl()}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: 'http://localhost:5000/auth/ebay/callback'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay OAuth failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const tokenData = await response.json();
    
    // Calculate expiration timestamp
    const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;
    
    this.currentToken = {
      ...tokenData,
      expires_at: expiresAt
    };

    // Store tokens in environment variables for persistence
    // Note: In production, these should be stored in a secure database
    process.env.EBAY_ACCESS_TOKEN = this.currentToken.access_token;
    process.env.EBAY_REFRESH_TOKEN = this.currentToken.refresh_token;
    process.env.EBAY_TOKEN_EXPIRES_AT = expiresAt.toString();

    return this.currentToken;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<void> {
    if (!this.currentToken?.refresh_token) {
      throw new Error("No refresh token available");
    }

    const credentials = Buffer.from(`${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`).toString('base64');
    
    const response = await fetch(`${this.getApiUrl()}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.currentToken.refresh_token,
        scope: 'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly https://api.ebay.com/oauth/api_scope/sell.marketing https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account.readonly https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.analytics.readonly'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay token refresh failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const tokenData = await response.json();
    
    // Calculate expiration timestamp
    const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;
    
    // Update current token, keeping refresh token if not provided
    this.currentToken = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || this.currentToken.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      expires_at: expiresAt
    };

    // Update environment variables
    process.env.EBAY_ACCESS_TOKEN = this.currentToken.access_token;
    if (tokenData.refresh_token) {
      process.env.EBAY_REFRESH_TOKEN = this.currentToken.refresh_token;
    }
    process.env.EBAY_TOKEN_EXPIRES_AT = expiresAt.toString();

    console.log("✅ eBay access token refreshed successfully");
  }

  /**
   * Generate OAuth authorization URL for user consent
   */
  generateAuthUrl(state?: string): string {
    const clientId = process.env.EBAY_APP_ID;
    // Use localhost redirect URI for development
    const redirectUri = 'http://localhost:5000/auth/ebay/callback'; 
    
    const scopes = [
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment', 
      'https://api.ebay.com/oauth/api_scope/sell.account'
    ].join(' ');

    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      state: state || 'auth_state'
    });

    return `https://auth.ebay.com/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Get current token info for debugging
   */
  getTokenInfo(): any {
    if (!this.currentToken) {
      return { status: 'No token available' };
    }

    return {
      hasAccessToken: !!this.currentToken.access_token,
      hasRefreshToken: !!this.currentToken.refresh_token,
      expiresAt: new Date(this.currentToken.expires_at * 1000).toISOString(),
      isValid: this.isTokenValid(),
      timeUntilExpiry: this.currentToken.expires_at - Math.floor(Date.now() / 1000)
    };
  }
}

export const ebayOAuth = new EbayOAuthService();