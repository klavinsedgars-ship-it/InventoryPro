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
      // Use the hardcoded token from eBay API Explorer
      const ebayUserToken = 'v^1.1#i^1#I^3#r^0#p^3#f^0#t^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';
      this.currentToken = {
        access_token: ebayUserToken,
        refresh_token: '',
        expires_in: 7200,
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
        redirect_uri: 'https://developer.ebay.com/DevZone/account/'
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
    const redirectUri = 'https://developer.ebay.com/DevZone/account/'; // Must match your app config
    
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