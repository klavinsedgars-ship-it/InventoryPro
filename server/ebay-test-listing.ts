// Test eBay listing without images to validate business policies

export function createTestListingXML(product: any): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<VerifyAddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${process.env.EBAY_USER_TOKEN}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <Title>${product.name} - Electronics Component for Development</Title>
    <Description><![CDATA[High-quality electronic component for development and prototyping projects. Arduino compatible. Original packaging.]]></Description>
    <PrimaryCategory>
      <CategoryID>58277</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="GBP">${parseFloat(product.salePrice.toString()).toFixed(2)}</StartPrice>
    <Quantity>${product.stock || 1}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>GB</Country>
    <Currency>GBP</Currency>
    <Location>London, UK</Location>
    <PostalCode>SW1A 1AA</PostalCode>
    <DispatchTimeMax>2</DispatchTimeMax>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>234560863019</ShippingProfileID>
      </SellerShippingProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>216006444019</PaymentProfileID>
      </SellerPaymentProfile>
      <SellerReturnProfile>
        <ReturnProfileID>209734982019</ReturnProfileID>
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
    <ItemLocation>London, UK</ItemLocation>
  </Item>
</VerifyAddFixedPriceItemRequest>`;
}