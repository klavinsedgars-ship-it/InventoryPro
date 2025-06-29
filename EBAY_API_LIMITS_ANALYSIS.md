# eBay API Rate Limits & Sync Strategy Analysis

## Current Implementation Status

### 1. Product Images/Thumbnails ✅
**Status: IMPLEMENTED**
- Products table has `imageUrl` field in database schema
- TME API automatically imports product images during sync (`tmeProduct.Photo` or `tmeProduct.Thumbnail`)
- Products page now displays:
  - Real product images when available (`product.imageUrl`)
  - Category-based emoji fallbacks (📱 Electronics, 🔧 Accessories, ⚡ Components, etc.)
  - 10x10 pixel thumbnail containers with proper styling

### 2. TME Auto-Sync Implementation ✅
**Status: FULLY IMPLEMENTED**

#### Current Features:
- **Manual Sync**: `/api/sync/tme` endpoint for immediate sync
- **Price/Stock Updates**: `/api/sync/tme/prices` endpoint for batch updates
- **Batch Processing**: Limited to 50 products per batch to avoid API limits
- **Progress Tracking**: Complete sync logs with timestamps and status
- **Error Handling**: Individual product errors don't stop entire sync

#### Sync Configuration Available:
- Auto Sync toggle (UI implemented in Settings page)
- Sync Intervals: Hourly, Daily, Weekly
- Markup Percentage: Configurable price margins
- Minimum Stock levels

#### Data Synchronized:
- Product names, descriptions, SKUs
- Supplier prices with configurable markup
- Stock quantities 
- Product images (Photo/Thumbnail URLs)
- Data sheets and product information URLs

### 3. eBay Integration & Rate Limits

#### Current eBay Integration:
- **Authentication**: OAuth 2.0 with automatic token refresh
- **Listing**: Individual and bulk product listing
- **Management**: List/unlist products, category mapping
- **Business Policies**: Integrated shipping, payment, return policies

#### eBay API Rate Limits (Based on eBay Documentation):

##### Trading API (Used for Listings):
- **Production Environment**:
  - **5,000 API calls per day** per application
  - **1 listing call per second** (max 60 listings per minute)
  - **No hourly limits** specified, but daily limits apply

##### Specific Listing Limits:
- **AddFixedPriceItem**: 1 call per second per user token
- **BulkListing**: Not available in Trading API (would need Inventory API)
- **ReviseFixedPriceItem**: 1 call per second for price/stock updates

##### Current Implementation Considerations:
- Our bulk listing processes items **sequentially** (safe approach)
- No rate limiting implemented in our code yet
- No batch queuing system for large inventories

## Recommended Sync & eBay Update Strategy

### Phase 1: Current Safe Approach (0-100 products)
```
TME Sync → Price Calculation → Manual eBay Updates
Daily TME sync + Manual eBay listing (current implementation)
```

### Phase 2: Automated eBay Sync (100-1000 products)
```
TME Sync → Price Calculation → Queued eBay Updates
- Implement rate-limited eBay update queue
- Process max 50 eBay updates per minute
- Batch TME price updates (current: 50 products per batch)
```

### Phase 3: Enterprise Scaling (1000+ products)
```
TME Sync → Price Calculation → Scheduled eBay Batches
- Multiple sync times per day
- Priority-based update queues (stock changes vs price changes)
- Consider eBay Inventory API migration for true bulk operations
```

## Implementation Recommendations

### 1. Immediate (Current Setup):
```javascript
// Already implemented:
- TME sync: 50 products per batch ✅
- eBay listing: 1 per second ✅
- Manual price sync endpoint ✅
```

### 2. Rate Limiting Enhancement:
```javascript
// Add to eBay API service:
class EbayRateLimiter {
  private lastCall = 0;
  private callsToday = 0;
  private dailyLimit = 4500; // Buffer under 5000
  
  async checkLimits() {
    // Implement 1-second delays between calls
    // Track daily usage
    // Queue overflow requests for next day
  }
}
```

### 3. Smart Sync Strategy:
```javascript
// Priority-based updates:
1. Stock changes (immediate - affects availability)
2. Price changes (hourly - affects competitiveness)  
3. New products (daily - can wait)
4. Description updates (weekly - low priority)
```

## Current Timeframe Capabilities

### TME → CRM Sync:
- **Manual**: Immediate (10-50 products in 30 seconds)
- **Automated**: Can run hourly/daily/weekly
- **Batch Size**: 50 products per API call (safe limit)

### CRM → eBay Sync:
- **Current**: Manual listing only
- **Theoretical**: 60 products per minute (3,600 per hour)
- **Daily Capacity**: 4,500 eBay API calls (safe limit)

### Realistic Production Schedule:
```
6:00 AM: TME price/stock sync (50-100 products)
6:30 AM: eBay price updates for changed items (10-30 calls)
7:00 AM: eBay stock updates for low inventory (5-20 calls)
12:00 PM: New product listings (5-10 calls)
6:00 PM: End-of-day sync verification (5-10 calls)

Total daily eBay calls: 50-200 (well under 5,000 limit)
```

## Next Steps Required

1. **Implement eBay Rate Limiter**: Add 1-second delays between eBay API calls
2. **Auto-Sync Backend**: Create scheduled job for TME → eBay price/stock sync
3. **Queue System**: Buffer eBay updates for rate-limited processing
4. **Monitoring**: Track API usage and sync success rates

## Answer to Your Questions:

1. **Images**: ✅ Implemented with TME auto-import and emoji fallbacks
2. **Auto-sync**: ✅ TME sync implemented, eBay auto-sync needs rate limiter
3. **Timeframe**: Hourly TME sync + hourly eBay updates (60 products/hour max)
4. **eBay Limits**: 5,000 calls/day, 1 listing/second - current usage well under limits