export function createBasicUKListingXML(product: any, authToken: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <Title>${product.name}</Title>
    <Description><![CDATA[${product.description || 'High-quality electronic component for development projects.'}]]></Description>
    <PrimaryCategory>
      <CategoryID>58277</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="GBP">${parseFloat(product.salePrice.toString()).toFixed(2)}</StartPrice>
    <Quantity>${product.stock || 1}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>LV</Country>
    <Currency>GBP</Currency>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ItemLocation>Riga, Latvia</ItemLocation>
    <PostalCode>LV-1010</PostalCode>
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>142140832019</ShippingProfileID>
      </SellerShippingProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>209734844019</PaymentProfileID>
      </SellerPaymentProfile>
      <SellerReturnProfile>
        <ReturnProfileID>161272624019</ReturnProfileID>
      </SellerReturnProfile>
    </SellerProfiles>
    ${product.imageUrl ? `<PictureDetails>
      <PictureURL>${product.imageUrl}</PictureURL>
    </PictureDetails>` : ''}
  </Item>
</AddFixedPriceItemRequest>`;
}