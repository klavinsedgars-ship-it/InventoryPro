// eBay Germany configuration and localization
export const EBAY_GERMANY_CONFIG = {
  siteId: "77", // eBay Germany site ID
  country: "DE",
  currency: "EUR",
  location: "Germany",
  postalCode: "10115", // Berlin postal code
  site: "Germany",
  language: "de-DE",
  
  // German shipping services
  shippingServices: {
    domestic: "DE_DHLPaket",
    international: "DE_DHLPaketInternational",
    express: "DE_DHLExpress"
  },
  
  // German electronics categories mapping
  categories: {
    electronics: "58277", // Electronic Components - Other (same as US)
    arduinoBoards: "58277",
    components: "58277",
    development: "58277"
  },
  
  // German business requirements
  businessPolicies: {
    // Note: Business policy IDs need to be configured for eBay Germany
    requiresGermanVAT: true,
    requiresBusinessRegistration: true,
    requiresImprintPage: true
  }
};

export function getGermanXMLConfig(product: any, businessPolicyIds?: {
  shipping?: string;
  payment?: string;
  return?: string;
}) {
  const config = EBAY_GERMANY_CONFIG;
  
  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>\${process.env.EBAY_USER_TOKEN}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <Title>\${product.name}</Title>
    <Description><![CDATA[\${product.description || 'Hochwertige Elektronikkomponente für Entwicklungs- und Prototyping-Projekte.'}]]></Description>
    <PrimaryCategory>
      <CategoryID>\${config.categories.electronics}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="\${config.currency}">\${parseFloat(product.salePrice.toString()).toFixed(2)}</StartPrice>
    <Quantity>\${product.stock || 1}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>\${config.country}</Country>
    <Currency>\${config.currency}</Currency>
    <Location>\${config.location}</Location>
    <PostalCode>\${config.postalCode}</PostalCode>
    <DispatchTimeMax>1</DispatchTimeMax>
    <Site>\${config.site}</Site>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    <PictureDetails>
      <PhotoDisplay>SuperSize</PhotoDisplay>
      <PictureURL>https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400</PictureURL>
    </PictureDetails>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>\${config.shippingServices.domestic}</ShippingService>
        <ShippingServiceCost currencyID="\${config.currency}">4.99</ShippingServiceCost>
        <ShippingServiceAdditionalCost currencyID="\${config.currency}">2.50</ShippingServiceAdditionalCost>
        <ShipToLocation>\${config.country}</ShipToLocation>
        <ShipToLocation>Europe</ShipToLocation>
        <ShipToLocation>Worldwide</ShipToLocation>
      </ShippingServiceOptions>
      <InternationalShippingServiceOption>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>\${config.shippingServices.international}</ShippingService>
        <ShippingServiceCost currencyID="\${config.currency}">12.99</ShippingServiceCost>
        <ShippingServiceAdditionalCost currencyID="\${config.currency}">5.99</ShippingServiceAdditionalCost>
        <ShipToLocation>Worldwide</ShipToLocation>
      </InternationalShippingServiceOption>
    </ShippingDetails>
    \${businessPolicyIds ? \`
    <SellerProfiles>
      \${businessPolicyIds.shipping ? \`<SellerShippingProfile><ShippingProfileID>\${businessPolicyIds.shipping}</ShippingProfileID></SellerShippingProfile>\` : ''}
      \${businessPolicyIds.payment ? \`<SellerPaymentProfile><PaymentProfileID>\${businessPolicyIds.payment}</PaymentProfileID></SellerPaymentProfile>\` : ''}
      \${businessPolicyIds.return ? \`<SellerReturnProfile><ReturnProfileID>\${businessPolicyIds.return}</ReturnProfileID></SellerReturnProfile>\` : ''}
    </SellerProfiles>\` : ''}
    <ItemSpecifics>
      <NameValueList>
        <Name>Brand</Name>
        <Value>Arduino</Value>
      </NameValueList>
      <NameValueList>
        <Name>Type</Name>
        <Value>Development Board</Value>
      </NameValueList>
      <NameValueList>
        <Name>MPN</Name>
        <Value>A000066</Value>
      </NameValueList>
    </ItemSpecifics>
    <ItemLocation>\${config.location}</ItemLocation>
  </Item>
</AddFixedPriceItemRequest>`;
}