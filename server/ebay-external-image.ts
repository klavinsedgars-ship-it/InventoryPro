// Alternative eBay listing with external image URL instead of hosted upload

export function createListingWithExternalImageXML(product: any, externalImageUrl: string): string {
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
    <StartPrice currencyID="EUR">${parseFloat(product.salePrice.toString()).toFixed(2)}</StartPrice>
    <Quantity>${product.stock || 1}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>DE</Country>
    <Currency>EUR</Currency>
    <Location>Berlin, Germany</Location>
    <PostalCode>10115</PostalCode>
    <DispatchTimeMax>2</DispatchTimeMax>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    <PictureDetails>
      <PictureURL>${externalImageUrl}</PictureURL>
    </PictureDetails>
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>263978529019</ShippingProfileID>
      </SellerShippingProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>216006440019</PaymentProfileID>
      </SellerPaymentProfile>
      <SellerReturnProfile>
        <ReturnProfileID>263978527019</ReturnProfileID>
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