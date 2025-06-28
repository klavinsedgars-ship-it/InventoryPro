# eBay Germany Business Policy Setup Guide

## Required Configuration for eBay.de Listings

### 1. eBay Germany Account Requirements

**Essential Account Setup:**
- eBay.de seller account (separate from eBay.com)
- German business registration (Gewerbeanmeldung) if selling commercially
- Valid German VAT ID (Umsatzsteuer-Identifikationsnummer) for EU sales
- German bank account for payments
- Verified address in Germany or EU

### 2. Business Policies Required for eBay Germany

#### A. Shipping Policy (Versandbedingungen)
**Required Elements:**
- **Domestic Shipping (Germany):**
  - DHL Paket: €4.99
  - DHL Express: €9.99
  - Hermes Paketversand: €3.99
  - Deutsche Post Warensendung: €2.50

- **EU Shipping:**
  - DHL Paket EU: €12.99
  - Hermes Europe: €9.99

- **International Shipping:**
  - DHL Paket International: €15.99
  - Express worldwide: €29.99

**Handling Time:**
- 1-2 business days (standard)
- Must comply with German distance selling laws

#### B. Payment Policy (Zahlungsbedingungen)
**Accepted Payment Methods in Germany:**
- PayPal (most common)
- Credit Cards (Visa, MasterCard)
- SEPA Direct Debit (Lastschrift)
- Sofortüberweisung (instant bank transfer)
- Cash on delivery (Nachnahme) - optional

**Payment Terms:**
- Immediate payment required for fixed-price listings
- Payment due within 7 days for auction items

#### C. Return Policy (Rückgabebedingungen)
**German Legal Requirements:**
- **14-day return period minimum** (EU consumer protection law)
- **30-day return period recommended** for better buyer confidence
- Buyer pays return shipping costs (unless item defective)
- Full refund including original shipping costs
- Must accept returns for distance sales (Fernabsatzgesetz)

**Return Process:**
1. Buyer contacts seller within return period
2. Seller provides return authorization and address
3. Buyer ships item back in original condition
4. Seller processes refund within 14 days

### 3. Legal Compliance Requirements

#### Impressum (Legal Notice)
**Required Information:**
- Full business name and address
- Phone number and email
- VAT ID number (if applicable)
- Business registration number
- Authorized representative details

#### Product Descriptions
**Must Include:**
- Accurate product specifications
- Country of origin
- Warranty information
- CE marking status (for electronics)
- Age restrictions if applicable
- Environmental disposal information (WEEE)

#### German Language Requirements
- Product titles in German recommended
- Descriptions can be German/English
- All policies must be available in German
- Customer service in German language

### 4. eBay Germany Category Specifications

#### Electronics Categories
- **Category 58277 (Elektronische Bauelemente - Sonstige)** ✅ Confirmed working
- Subcategories available:
  - Entwicklerboards (Development Boards)
  - Mikrocontroller (Microcontrollers)
  - Elektronische Bauteile (Electronic Components)

#### Required Item Specifics for Electronics
- Marke (Brand): Arduino, Raspberry Pi, etc.
- Typ (Type): Entwicklerboard, Mikrocontroller
- Modell (Model): Uno R3, Nano, etc.
- Herstellernummer (MPN): A000066, etc.
- Herkunftsland (Country of Manufacture)

### 5. Implementation Steps

#### Step 1: Create eBay Germany Business Policies
1. Log into eBay.de seller account
2. Go to "Mein eBay" → "Verkaufsmanager" → "Rahmenbedingungen"
3. Create new shipping policy with German services
4. Create payment policy with German payment methods
5. Create return policy compliant with German law
6. Note the Policy IDs for API integration

#### Step 2: Update API Configuration
```typescript
// German Business Policy IDs (to be obtained from eBay.de)
const GERMAN_BUSINESS_POLICIES = {
  shipping: "DE_SHIPPING_POLICY_ID", // From eBay.de account
  payment: "DE_PAYMENT_POLICY_ID",   // From eBay.de account
  return: "DE_RETURN_POLICY_ID"      // From eBay.de account
};
```

#### Step 3: Validate German Shipping Services
Test these German shipping service codes:
- `DE_DHLPaket` - DHL standard
- `DE_DHLExpress` - DHL express
- `DE_HermesParcel` - Hermes standard
- `DE_DeutschePostWarensendung` - Deutsche Post

### 6. Common German eBay Error Codes

**21917327** - Invalid shipping conditions
**21917328** - Invalid payment conditions  
**21917329** - Invalid return conditions
**21916552** - Missing VAT information
**21916553** - Invalid business registration

### 7. Testing Checklist

Before live listing:
- [ ] Valid German business policies created
- [ ] Policy IDs updated in API configuration
- [ ] German shipping services validated
- [ ] VAT settings configured
- [ ] Impressum page created
- [ ] Product descriptions comply with German law
- [ ] Return process documented in German

### 8. Next Actions Required

1. **Immediate**: Create business policies in eBay.de seller account
2. **Get Policy IDs**: Note the generated policy IDs for API integration
3. **Update API**: Replace US policy IDs with German ones
4. **Test Listing**: Attempt listing with valid German policies
5. **Verify Compliance**: Ensure all legal requirements met

---

**Important Note**: German e-commerce has strict legal requirements. Consider consulting with a German business lawyer for complete compliance, especially for VAT and consumer protection laws.