// eBay OAuth 2.0 Unified Token Manager
// Handles all eBay API authentication (REST APIs + Trading API)
// Uses OAuth 2.0 with automatic token refresh

interface EbayOAuthToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  expires_at: number; // Calculated timestamp when token expires (milliseconds)
}

// Scopes the refresh token was granted — and therefore the ONLY scopes we may
// request on a refresh_token grant. eBay rejects the whole refresh with
// invalid_scope if we ask for anything outside this set, which would break
// every eBay call. Do NOT add gated/beta scopes here until the refresh token
// has actually been re-authorized to include them.
const EBAY_BASE_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',                    // Base scope for Trading API
  'https://api.ebay.com/oauth/api_scope/sell.account',       // Business policies
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',     // Inventory management
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',     // Promotions
  'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',   // Order fulfillment
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
];

// Marketplace Insights (Buy API beta) — gated; requires an eBay allow-list.
const INSIGHTS_SCOPE = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';

// Scopes requested on every token REFRESH. eBay rejects a refresh whose scope
// isn't a subset of what the refresh token was granted, so insights is included
// ONLY when EBAY_INSIGHTS_ENABLED=true. Flip that on *after* (a) eBay approves
// your app for Marketplace Insights AND (b) you've re-consented via
// /api/research/insights-connect so the refresh token actually carries the
// scope — otherwise the refresh fails invalid_scope and every eBay call breaks.
const EBAY_OAUTH_SCOPES = [
  ...EBAY_BASE_SCOPES,
  ...(process.env.EBAY_INSIGHTS_ENABLED === 'true' ? [INSIGHTS_SCOPE] : []),
].join(' ');

// Scopes advertised on the consent/authorization URL. Always includes insights
// so a re-consent grants it; harmless before approval since it only affects a
// fresh consent flow, never the refresh path.
const EBAY_CONSENT_SCOPES = [
  ...EBAY_BASE_SCOPES,
  INSIGHTS_SCOPE,
].join(' ');

export class EbayOAuthService {
  private cachedToken: EbayOAuthToken | null = null;
  private baseUrl = "https://api.ebay.com";
  private sandboxUrl = "https://api.sandbox.ebay.com";
  private isProduction = true;
  private isConfigured = false;

  constructor() {
    this.checkConfiguration();
  }

  private checkConfiguration(): void {
    const clientId = process.env.EBAY_OAUTH_CLIENT_ID || process.env.EBAY_APP_ID;
    const clientSecret = process.env.EBAY_OAUTH_CLIENT_SECRET || process.env.EBAY_CERT_ID;
    const refreshToken = process.env.EBAY_OAUTH_REFRESH_TOKEN || process.env.EBAY_REFRESH_TOKEN;

    this.isConfigured = !!(clientId && clientSecret && refreshToken);

    if (this.isConfigured) {
      console.log("✅ eBay OAuth Service initialized");
      console.log("   Unified OAuth for all eBay APIs (REST + Trading)");
    } else {
      console.log("⚠️ eBay OAuth not fully configured");
      console.log("   Required: EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, EBAY_OAUTH_REFRESH_TOKEN");
    }
  }

  /**
   * Check if OAuth is properly configured
   */
  public isOAuthConfigured(): boolean {
    return this.isConfigured;
  }

  private getApiUrl(): string {
    return this.isProduction ? this.baseUrl : this.sandboxUrl;
  }

  private getClientCredentials(): { clientId: string; clientSecret: string; refreshToken: string } {
    const clientId = process.env.EBAY_OAUTH_CLIENT_ID || process.env.EBAY_APP_ID || '';
    const clientSecret = process.env.EBAY_OAUTH_CLIENT_SECRET || process.env.EBAY_CERT_ID || '';
    const refreshToken = process.env.EBAY_OAUTH_REFRESH_TOKEN || process.env.EBAY_REFRESH_TOKEN || '';
    return { clientId, clientSecret, refreshToken };
  }

  /**
   * Check if cached token is still valid (with 5 minute buffer)
   */
  private isTokenValid(): boolean {
    if (!this.cachedToken) return false;
    // 5 minute buffer before expiry
    return Date.now() < this.cachedToken.expires_at - 300000;
  }

  /**
   * Get a valid OAuth access token for REST API calls
   * Automatically refreshes if expired
   */
  async getValidAccessToken(): Promise<string> {
    if (!this.isConfigured) {
      throw new Error(
        "eBay OAuth not configured. Set EBAY_OAUTH_CLIENT_ID, EBAY_OAUTH_CLIENT_SECRET, and EBAY_OAUTH_REFRESH_TOKEN."
      );
    }

    // Return cached token if still valid
    if (this.cachedToken && this.isTokenValid()) {
      return this.cachedToken.access_token;
    }

    // Refresh the token
    await this.refreshAccessToken();
    return this.cachedToken!.access_token;
  }

  /**
   * Get a valid OAuth token for Trading API calls (XML-based)
   * Uses the same OAuth token - Trading API accepts OAuth via X-EBAY-API-IAF-TOKEN header
   */
  async getTradingApiToken(): Promise<string> {
    return this.getValidAccessToken();
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    const { clientId, clientSecret, refreshToken } = this.getClientCredentials();

    if (!refreshToken) {
      throw new Error("No refresh token available. Please re-authorize the application.");
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenUrl = `${this.getApiUrl()}/identity/v1/oauth2/token`;

    console.log("🔄 Refreshing eBay OAuth access token...");

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: EBAY_OAUTH_SCOPES
        }).toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ OAuth token refresh failed:", response.status, errorText);
        throw new Error(`eBay OAuth refresh failed: ${response.status} - ${errorText}`);
      }

      const tokenData = await response.json();

      // Cache the token with expiration
      this.cachedToken = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refreshToken,
        expires_in: tokenData.expires_in,
        token_type: tokenData.token_type || 'Bearer',
        expires_at: Date.now() + (tokenData.expires_in * 1000)
      };

      console.log("✅ eBay OAuth token refreshed successfully");
      console.log(`   Token expires in: ${tokenData.expires_in} seconds`);

    } catch (error) {
      console.error("❌ Failed to refresh eBay OAuth token:", error);
      throw error;
    }
  }

  /**
   * Exchange authorization code for initial tokens (OAuth consent flow)
   */
  async exchangeCodeForTokens(authorizationCode: string, redirectUri: string): Promise<EbayOAuthToken> {
    const { clientId, clientSecret } = this.getClientCredentials();
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(`${this.getApiUrl()}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: redirectUri
      }).toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay OAuth exchange failed: ${response.status} - ${errorText}`);
    }

    const tokenData = await response.json();

    this.cachedToken = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type || 'Bearer',
      expires_at: Date.now() + (tokenData.expires_in * 1000)
    };

    console.log("✅ eBay OAuth tokens obtained successfully");
    console.log("   IMPORTANT: Save the refresh token to EBAY_OAUTH_REFRESH_TOKEN");
    console.log(`   Refresh Token: ${tokenData.refresh_token}`);

    return this.cachedToken;
  }

  /**
   * Generate OAuth authorization URL for user consent
   */
  generateAuthUrl(redirectUri: string, state?: string): string {
    const { clientId } = this.getClientCredentials();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: EBAY_CONSENT_SCOPES,
      state: state || 'ebay_auth_state'
    });

    return `https://auth.ebay.com/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Get current token info for debugging
   */
  getTokenInfo(): {
    configured: boolean;
    hasToken: boolean;
    isValid: boolean;
    expiresAt?: string;
    expiresIn?: number;
  } {
    return {
      configured: this.isConfigured,
      hasToken: !!this.cachedToken,
      isValid: this.isTokenValid(),
      expiresAt: this.cachedToken ? new Date(this.cachedToken.expires_at).toISOString() : undefined,
      expiresIn: this.cachedToken ? Math.floor((this.cachedToken.expires_at - Date.now()) / 1000) : undefined
    };
  }

  /**
   * Force reload configuration (useful after env var changes)
   */
  reloadConfiguration(): void {
    this.cachedToken = null;
    this.checkConfiguration();
  }
}

// Singleton instance
export const ebayOAuth = new EbayOAuthService();
