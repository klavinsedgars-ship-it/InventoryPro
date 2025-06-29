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

## ENTERPRISE SCALE: 150K Products Strategy

### **Critical Math for 150K Products:**

#### eBay API Constraints:
- **5,000 calls/day limit = MAJOR BOTTLENECK**
- **150,000 products ÷ 5,000 calls = 30 DAYS** to list all products
- **Daily processing capacity: 5,000 products max**
- **Realistic daily capacity: 4,500 products** (safety buffer)

#### Required Architecture Changes:

### **Phase 1: Queue-Based Processing System**
```javascript
// Implement job queue with priority levels:
1. CRITICAL: Stock = 0 (unlist immediately)
2. HIGH: Stock changes (update within 1 hour)  
3. MEDIUM: Price changes (update within 4 hours)
4. LOW: New listings (process over 30 days)
```

### **Phase 2: Multi-App Strategy**
```
eBay allows multiple applications per developer account:
- App 1: New listings (5,000 calls/day)
- App 2: Price updates (5,000 calls/day) 
- App 3: Stock updates (5,000 calls/day)
- App 4: Product management (5,000 calls/day)

Total capacity: 20,000 API calls/day
```

### **Phase 3: eBay Inventory API Migration**
```
Trading API → Inventory API benefits:
- Bulk operations (1 call = 25 products)
- Higher rate limits for enterprise accounts
- Better for large catalogs
- Required for 150K+ scale
```

## **Immediate Implementation Requirements:**

### **1. Database Optimization:**
```sql
-- Add indices for queue processing:
CREATE INDEX idx_products_sync_priority ON products(status, listedOnEbay, updatedAt);
CREATE INDEX idx_products_stock_changes ON products(stock, listedOnEbay);
CREATE INDEX idx_sync_queue_priority ON sync_queue(priority, status, createdAt);
```

### **2. Sync Queue Table:**
```sql
CREATE TABLE sync_queue (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  operation VARCHAR(50), -- 'list', 'update_price', 'update_stock', 'unlist'
  priority INTEGER, -- 1=critical, 2=high, 3=medium, 4=low
  status VARCHAR(20), -- 'pending', 'processing', 'completed', 'failed'
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  scheduled_for TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP
);
```

### **3. Rate-Limited Worker System:**
```javascript
class EbayQueueProcessor {
  private callsToday = 0;
  private dailyLimit = 4500;
  private lastCall = 0;
  private minInterval = 1000; // 1 second between calls
  
  async processQueue() {
    // Process up to daily limit with 1-second intervals
    // Priority-based processing
    // Automatic retry with exponential backoff
  }
}
```

## **150K Product Sync Timeline:**

### **Optimistic Scenario (Multi-App Setup):**
- **Week 1**: Critical infrastructure (queue system, rate limiting)
- **Week 2**: Initial listing batch (35,000 products)
- **Week 3-4**: Continue listing (70,000 more products) 
- **Week 5-6**: Complete initial listing (45,000 remaining)
- **Ongoing**: Real-time sync maintenance

### **Realistic Timeline:**
- **Month 1**: Core infrastructure + first 30,000 products
- **Month 2**: Scale to 60,000 products with optimizations
- **Month 3**: Complete 150K with mature queue system
- **Month 4+**: Maintenance mode with real-time sync

## **Cost & Infrastructure Considerations:**

### **eBay API Applications Needed:**
- **Primary App**: Listings (current)
- **Secondary Apps**: 2-3 additional apps for parallel processing
- **Enterprise Account**: Consider eBay Partner Network for higher limits

### **Infrastructure Scaling:**
- **Database**: PostgreSQL with proper indexing
- **Queue Processing**: Background job workers
- **Monitoring**: API usage tracking, success rates
- **Error Handling**: Dead letter queues, manual intervention tools

## **Action Plan for 150K Scale:**

### **Immediate (Week 1):**
1. Implement sync queue table and priority system
2. Build rate-limited eBay processor with 1-second intervals
3. Create monitoring dashboard for API usage
4. Test with current 11 products to validate queue system

### **Short-term (Month 1):**
1. Apply for additional eBay developer applications
2. Implement bulk TME sync (500+ products per batch)
3. Deploy automated queue worker with retry logic
4. Begin systematic listing of first 30,000 products

### **Medium-term (Month 2-3):**
1. Migrate to eBay Inventory API for true bulk operations
2. Implement smart sync (only changed products)
3. Add predictive stock management
4. Scale to full 150K product catalog

**The 150K target is achievable, but requires significant architecture changes and 2-3 months of systematic processing.**