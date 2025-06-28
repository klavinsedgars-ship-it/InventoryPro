export function createMinimalUSListingXML(product: any, authToken: string): string {
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
    <StartPrice currencyID="USD">${parseFloat(product.salePrice.toString()).toFixed(2)}</StartPrice>
    <Quantity>${product.stock || 1}</Quantity>
    <ListingDuration>GTC</ListingDuration>
    <Country>US</Country>
    <Currency>USD</Currency>
    <ListingType>FixedPriceItem</ListingType>
    <ConditionID>1000</ConditionID>
    <DispatchTimeMax>3</DispatchTimeMax>
  </Item>
</AddFixedPriceItemRequest>`;
}