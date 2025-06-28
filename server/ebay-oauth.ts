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
      const ebayUserToken = 'v^1.1#i^1#p^1#r^0#I^3#f^0#t^H4sIAAAAAAAA/+VYbWwURRi+a3tALUWMBAwRPBYJYHN7s7v3uXKH1y9aKW3tlSIlBmd3Z9uhe7vr7p7XK0TORj4j/IGgQpD+AU1MiGiQqBFQkAQIAdHoDxI/SgSCCCj4FWh0d1vKtRK+eolNvD+Xeeedd57nmfedmR2QGVH4xMqqlX8UO0fmdWVAJs/ppIpA4QhXyZj8vIkuB8hycHZlHs8UdOafm6XDhKSyDUhXFVlH7vaEJOusbYwQSU1mFahjnZVhAumswbPx2LwaliYBq2qKofCKRLiryyOEKIJAmAnS4YBfoLgAZVrlGzEblQgR8ofEIBPkYBDRYtDHm/26nkTVsm5A2YgQNKD9HhDw0KFGGrDAxzJhkmKYZsLdhDQdK7LpQgIiasNl7bFaFtbbQ4W6jjTDDEJEq2OV8bpYdXlFbeMsb1asaJ8OcQMaSX1gq0wRkLsJSkl0+2l025uNJ3ke6TrhjfbOMDAoG7sB5j7g21L7RCbEc8AX4ERIU4DJiZSVipaAxu1xWBYseETblUWygY30nRQ11eCWIN7oa9WaIarL3dbfM0koYREjLUJUlMYWxurriehcqElYb8KeyqQkYcVT31DuEQQfFENBH/BQ/hANfEy4b5reWH0iD5qnTJEFbEmmu2sVoxSZmNEAZagw689SxnSqk+u0mGhYeLIVpG8oSIearSXtXcOk0Spbq4oSpgxuu3ln/ftHG4aGuaSB+iMM7rAFihBQVbFADO60M7Evedr1CNFqGCrr9aZSKTLFkIrW4qUBoLzPzquJ860oAQnb16p1yx/feYAH21R4ZI7UMWukVRNLu5mpJgC5hYj6GMbnZ/p0HwgrOtj6L0MWZ+/AeshVfTB+Ggl8kAmEOQBFIOSiPqJ9Keq1cCAOpj0JqLUhQ5Ugjzy8mWfJBNKwwDJ+kWZCIvIIgbDo8YVF0cP5hYCHEhECCHEcHw79f8rkbhM9jngNGTnK9FxleUMJv6QKtjaojQs65mO9xD+/hZbnyjXJKlTi4zvKS2MdS/ypuFYVi9xtLdySfJmETWUazflzJYBV67kRoUrRDSQMiV6cV1RUr0iYTw+vBWY0oR5qRjqOzCKSW4ZEMqaq1bnaqXNE7542iftjncvz6T85m27JSrcSdnixssbrZgCoYtI6fUheSXgVaF47vFatm+bFNuoh8cbmnXVYsTZJ9rLFQu9lk7Qpk/qLPKkhXUlq5j2brLNuX41KG5LN08zQFElCWhM15GpOJJIG5CQ03Mo6BwmO4TA7aqmgn6J8FAgObTvi7YN08XDbknK3ERfMvscLtXfgx33UYf+oTudnoNO5N8/pBLPANGoqmDIif35B/uiJOjYQiaFI6rhFNr9ZNUS2obQKsZb3sOP4mBrh5aqa3zJccs+Cq7NDjuKst4Wu58Aj/a8LhflUUdZTA3j0Zo+LenBCMe0HAdqkbfFuBlNv9hZQ4wvG/cVu/+7zLadPHgsXL21bIL+w8ddRPaC438npdDkKOp2OxPLHJmxW3DOuTNvx56SNjjmRp3+/OLnolXUPnHEW14+Mv//eDLxn36L0+d3dZw+lL/B0067aMu3Shd0zP+ZW7PzpJe+1nrNLN61v3vruNx2F0Z1zxi3KnDzaid4cBY90NS9KhaaHXp9rTP52YTxx+vuvxy6fPP7s2B306l/o1tXbDvgORqL1m7/EFa8eE89V/pza/2PR2+wbSz95/nLPdXXNmUljMu+cOuqiV/RcPtjlWha/cnjKSPL8mquXutce/6Lk2Aly1ZEfDmij8bWnPj2Vuv7BBur6nhV/w/YPZ+6SXut4a/rFQxNX7Z22ceu2hz5av0XZ3n14XcXoCYWlJ57c5+c2+ZZ9tX+L6/yG2d29a/kPAOvugfURAAA=';
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