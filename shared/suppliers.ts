/**
 * Suppliers whose products are allowed to reach eBay. This list IS the
 * quarantine boundary: a supplier not named here is invisible to the listing
 * ramp and the manual listing paths, however its rows got into `products`.
 * GETIC added 2026-09-02 when its promotion step went live, GREENCELL
 * 2026-09-02 with the generic supplier-feed framework; "manual" stays out
 * deliberately (operator test rows must not auto-list).
 */
export const LISTING_SUPPLIERS = ["TME", "GETIC", "GREENCELL"] as const;
