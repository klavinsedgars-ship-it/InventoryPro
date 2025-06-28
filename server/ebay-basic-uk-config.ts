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
    <Country>GB</Country>
    <Currency>GBP</Currency>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ItemLocation>London, UK</ItemLocation>
    <PostalCode>SW1A 1AA</PostalCode>
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
    <PictureDetails>
      <PictureURL>https://images.unsplash.com/photo-1553062407-98eeb64c6a62</PictureURL>
    </PictureDetails>
  </Item>
</AddFixedPriceItemRequest>`;
}