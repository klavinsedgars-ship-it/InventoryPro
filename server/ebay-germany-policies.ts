// eBay Germany Business Policies Management
import { EBAY_GERMANY_CONFIG } from './ebay-germany-config';

export interface GermanBusinessPolicies {
  shipping: string;
  payment: string;
  return: string;
}

// German business policy IDs from eBay.de account (Updated)
export const GERMAN_BUSINESS_POLICIES: GermanBusinessPolicies = {
  shipping: "263978529019", // German shipping policy
  payment: "216006440019",  // German payment policy
  return: "263978527019"    // German return policy
};

export function createGermanShippingPolicyXML() {
  return `
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>DE_DHLPaket</ShippingService>
        <ShippingServiceCost currencyID="EUR">4.99</ShippingServiceCost>
        <ShippingServiceAdditionalCost currencyID="EUR">2.50</ShippingServiceAdditionalCost>
        <ShipToLocation>DE</ShipToLocation>
      </ShippingServiceOptions>
      <ShippingServiceOptions>
        <ShippingServicePriority>2</ShippingServicePriority>
        <ShippingService>DE_HermesParcel</ShippingService>
        <ShippingServiceCost currencyID="EUR">3.99</ShippingServiceCost>
        <ShippingServiceAdditionalCost currencyID="EUR">1.99</ShippingServiceAdditionalCost>
        <ShipToLocation>DE</ShipToLocation>
      </ShippingServiceOptions>
      <InternationalShippingServiceOption>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>DE_DHLPaketInternational</ShippingService>
        <ShippingServiceCost currencyID="EUR">12.99</ShippingServiceCost>
        <ShippingServiceAdditionalCost currencyID="EUR">5.99</ShippingServiceAdditionalCost>
        <ShipToLocation>Europe</ShipToLocation>
        <ShipToLocation>Worldwide</ShipToLocation>
      </InternationalShippingServiceOption>
    </ShippingDetails>`;
}

export function createGermanReturnPolicyXML() {
  return `
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
      <Description>30 Tage Rückgaberecht. Käufer zahlt Rückversand. Vollständige Rückerstattung bei Rücksendung in Originalzustand.</Description>
    </ReturnPolicy>`;
}

export function createGermanPaymentMethodsXML() {
  return `
    <PaymentMethods>PayPal</PaymentMethods>
    <PaymentMethods>CreditCard</PaymentMethods>
    <PaymentMethods>MOCC</PaymentMethods>
    <PayPalEmailAddress>your-paypal@email.com</PayPalEmailAddress>`;
}

// Generate listing XML for eBay Germany without business policies (manual shipping/payment/return)
export function createGermanListingXML(product: any): string {
  const config = EBAY_GERMANY_CONFIG;
  
  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${process.env.EBAY_USER_TOKEN}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <Title>${product.name}</Title>
    <Description><![CDATA[${product.description || 'Hochwertige Elektronikkomponente für Entwicklungs- und Prototyping-Projekte. Arduino kompatibel.'}]]></Description>
    <PrimaryCategory>
      <CategoryID>${config.categories.electronics}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="${config.currency}">${parseFloat(product.salePrice.toString()).toFixed(2)}</StartPrice>
    <Quantity>${product.stock || 1}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>${config.country}</Country>
    <Currency>${config.currency}</Currency>
    <Location>${config.location}</Location>
    <PostalCode>${config.postalCode}</PostalCode>
    <DispatchTimeMax>2</DispatchTimeMax>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    <PictureDetails>
      <PhotoDisplay>SuperSize</PhotoDisplay>
      <PictureURL>https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400</PictureURL>
    </PictureDetails>
    ${createGermanShippingPolicyXML()}
    ${createGermanReturnPolicyXML()}
    ${createGermanPaymentMethodsXML()}
    <ItemSpecifics>
      <NameValueList>
        <Name>Marke</Name>
        <Value>Arduino</Value>
      </NameValueList>
      <NameValueList>
        <Name>Typ</Name>
        <Value>Entwicklerboard</Value>
      </NameValueList>
      <NameValueList>
        <Name>Modell</Name>
        <Value>Uno R3</Value>
      </NameValueList>
      <NameValueList>
        <Name>Herstellernummer</Name>
        <Value>A000066</Value>
      </NameValueList>
      <NameValueList>
        <Name>Herkunftsland</Name>
        <Value>Italien</Value>
      </NameValueList>
    </ItemSpecifics>
    <ItemLocation>${config.location}</ItemLocation>
  </Item>
</AddFixedPriceItemRequest>`;
}

// Function to update business policy IDs when obtained from eBay.de
export function updateGermanBusinessPolicies(policies: GermanBusinessPolicies) {
  GERMAN_BUSINESS_POLICIES.shipping = policies.shipping;
  GERMAN_BUSINESS_POLICIES.payment = policies.payment;
  GERMAN_BUSINESS_POLICIES.return = policies.return;
}