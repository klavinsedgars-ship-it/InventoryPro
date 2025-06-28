export function createSimpleUKListingXML(product: any, authToken: string, imageUrl?: string | null): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <Title>${product.name} - Arduino Microcontroller Board</Title>
    <Description><![CDATA[High-quality electronic component for development and prototyping projects. Arduino compatible. Original packaging.]]></Description>
    <PrimaryCategory>
      <CategoryID>58277</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="GBP">${parseFloat(product.salePrice.toString()).toFixed(2)}</StartPrice>
    <Quantity>${product.stock || 1}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>LV</Country>
    <Currency>GBP</Currency>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>UK_RoyalMailSecondClass</ShippingService>
        <ShippingServiceCost>2.99</ShippingServiceCost>
      </ShippingServiceOptions>
    </ShippingDetails>
    <PaymentMethods>PayPal</PaymentMethods>
    <PayPalEmailAddress>payments@example.com</PayPalEmailAddress>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
    </ReturnPolicy>
    ${imageUrl ? `<PictureDetails>
      <PictureURL>${imageUrl}</PictureURL>
    </PictureDetails>` : ''}
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
        <Name>Model</Name>
        <Value>Uno R3</Value>
      </NameValueList>
    </ItemSpecifics>
    <ItemLocation>London, UK</ItemLocation>
  </Item>
</AddFixedPriceItemRequest>`;
}