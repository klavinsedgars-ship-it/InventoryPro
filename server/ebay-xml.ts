/**
 * Pure XML parsing for eBay Trading API responses — NO API, NO DB, NO env.
 * Extracted from ebay-api.ts so the parsing (the fragile regex part of the
 * reconciliation path) is unit-testable without credentials or a database.
 */

export interface ActiveListingEntry {
  itemId: string;
  sku: string | null;
  title: string;
  price: number | null;
  quantity: number | null;
}

export interface ActiveListPage {
  items: ActiveListingEntry[];
  totalPages: number;
  totalEntries: number;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Throws when the response reports Ack=Failure (with eBay's own message). */
export function assertTradingAck(response: string, fallbackMessage: string): void {
  const ack = response.match(/<Ack>(.*?)<\/Ack>/)?.[1];
  if (ack === "Failure") {
    throw new Error(
      response.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1]
      || response.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1]
      || fallbackMessage,
    );
  }
}

/** Parse one GetMyeBaySelling response's ActiveList into entries + paging. */
export function parseActiveListings(response: string): ActiveListPage {
  const activeBlock = response.match(/<ActiveList>([\s\S]*?)<\/ActiveList>/)?.[1] ?? "";
  const totalPages = parseInt(activeBlock.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/)?.[1] ?? "1", 10);
  const totalEntries = parseInt(activeBlock.match(/<TotalNumberOfEntries>(\d+)<\/TotalNumberOfEntries>/)?.[1] ?? "0", 10);

  const items: ActiveListingEntry[] = [];
  const itemBlocks = activeBlock.match(/<Item>[\s\S]*?<\/Item>/g) ?? [];
  for (const block of itemBlocks) {
    const itemId = block.match(/<ItemID>(\d+)<\/ItemID>/)?.[1];
    if (!itemId) continue;
    const rawTitle = block.match(/<Title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/Title>/)?.[1] ?? "";
    const price = block.match(/<CurrentPrice[^>]*>([\d.]+)<\/CurrentPrice>/)?.[1];
    // ActiveList reports remaining stock as QuantityAvailable; fall back to
    // Quantity for older payload shapes.
    const qty = block.match(/<QuantityAvailable>(\d+)<\/QuantityAvailable>/)?.[1]
      ?? block.match(/<Quantity>(\d+)<\/Quantity>/)?.[1];
    items.push({
      itemId,
      sku: block.match(/<SKU>([\s\S]*?)<\/SKU>/)?.[1]?.trim() || null,
      title: unescapeXml(rawTitle),
      price: price != null ? parseFloat(price) : null,
      quantity: qty != null ? parseInt(qty, 10) : null,
    });
  }
  return { items, totalPages, totalEntries };
}
