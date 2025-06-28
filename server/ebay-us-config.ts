export function createSimpleUSListingXML(product: any): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${process.env.EBAY_USER_TOKEN}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <Title>${product.name} - Arduino Microcontroller Board</Title>
    <Description><![CDATA[High-quality electronic component for development and prototyping projects. Arduino compatible. Original packaging.]]></Description>
    <PrimaryCategory>
      <CategoryID>58277</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="USD">${parseFloat(product.salePrice.toString()).toFixed(2)}</StartPrice>
    <Quantity>${product.stock || 1}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>US</Country>
    <Currency>USD</Currency>
    <Location>New York, NY</Location>
    <PostalCode>10001</PostalCode>
    <DispatchTimeMax>2</DispatchTimeMax>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>YOUR_US_SHIPPING_POLICY_ID</ShippingProfileID>
      </SellerShippingProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>YOUR_US_PAYMENT_POLICY_ID</PaymentProfileID>
      </SellerPaymentProfile>
      <SellerReturnProfile>
        <ReturnProfileID>YOUR_US_RETURN_POLICY_ID</ReturnProfileID>
      </SellerReturnProfile>
    </SellerProfiles>
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
    <ItemLocation>New York, NY</ItemLocation>
  </Item>
</AddFixedPriceItemRequest>`;
}