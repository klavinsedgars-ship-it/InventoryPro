/**
 * Suppliers whose products are allowed to reach eBay. This list IS the
 * quarantine boundary: a supplier not named here is invisible to the listing
 * ramp and the manual listing paths, however its rows got into `products`.
 * GETIC added 2026-09-02 when its promotion step went live, GREENCELL
 * 2026-09-02 with the generic supplier-feed framework, ACC 2026-09-15 when
 * its API import went live; "manual" stays out deliberately (operator test
 * rows must not auto-list).
 *
 * Membership here is not the same as being listed: promotion into `products`
 * is still a deliberate, per-offer act. This list only says a supplier's
 * promoted rows are ALLOWED to reach a marketplace.
 */
export const LISTING_SUPPLIERS = ["TME", "GETIC", "GREENCELL", "ACC"] as const;
