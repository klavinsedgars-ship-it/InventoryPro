/**
 * Pre-flight validation for the eBay listing pipeline. Listing thousands of
 * products requires several env vars and external bits to be set correctly;
 * if any are missing the publish step fails identically for every product.
 * Surfacing this before a batch starts (and on the Ops dashboard) prevents
 * burning quota and producing 0-published runs.
 */
export interface EbayEnvIssue {
  level: "error" | "warning";
  key: string;
  message: string;
}

export function validateListingEnv(): {
  ok: boolean;
  issues: EbayEnvIssue[];
} {
  const issues: EbayEnvIssue[] = [];

  // OAuth credentials — without these no eBay call can complete.
  for (const k of ["EBAY_OAUTH_CLIENT_ID", "EBAY_OAUTH_CLIENT_SECRET", "EBAY_OAUTH_REFRESH_TOKEN"]) {
    if (!process.env[k]) issues.push({ level: "error", key: k, message: `${k} is not set — eBay OAuth will not work.` });
  }

  // Business policies — Inventory API publish requires both, no fallback.
  // Without these every offer fails identically with an undefined policy id.
  if (!process.env.EBAY_PAYMENT_PROFILE_ID) {
    issues.push({
      level: "error",
      key: "EBAY_PAYMENT_PROFILE_ID",
      message: "EBAY_PAYMENT_PROFILE_ID is not set — every offer will fail to publish.",
    });
  }
  if (!process.env.EBAY_RETURN_PROFILE_ID) {
    issues.push({
      level: "error",
      key: "EBAY_RETURN_PROFILE_ID",
      message: "EBAY_RETURN_PROFILE_ID is not set — every offer will fail to publish.",
    });
  }

  // Merchant location — has a default key, but if absent inventory items
  // cannot be linked to a fulfillment location.
  if (!process.env.EBAY_MERCHANT_LOCATION_KEY) {
    issues.push({
      level: "warning",
      key: "EBAY_MERCHANT_LOCATION_KEY",
      message: "EBAY_MERCHANT_LOCATION_KEY unset — using 'default-location'. Listing will try to create it.",
    });
  }

  // Image hosting — without a Blob token (and PUBLIC_BASE_URL fallback),
  // image processing silently falls back to the raw watermarked TME URL,
  // and listings ship with competitor watermarks visible.
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.PUBLIC_BASE_URL) {
    issues.push({
      level: "error",
      key: "BLOB_READ_WRITE_TOKEN",
      message:
        "Neither BLOB_READ_WRITE_TOKEN nor PUBLIC_BASE_URL is set — listings would publish with raw watermarked supplier images.",
    });
  }

  // Default category — fallback only, but if Taxonomy fails this is the
  // last line; if it's unset some products will fail outright.
  if (!process.env.EBAY_DEFAULT_CATEGORY_ID) {
    issues.push({
      level: "warning",
      key: "EBAY_DEFAULT_CATEGORY_ID",
      message:
        "EBAY_DEFAULT_CATEGORY_ID is not set — if Taxonomy fails for a product it will be skipped.",
    });
  }

  return { ok: issues.every((i) => i.level !== "error"), issues };
}
