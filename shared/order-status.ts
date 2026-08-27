/**
 * Order fulfilment status transitions.
 *
 * Packing is done by hand and mis-clicks happen: marking an order packed or
 * shipped was previously a one-way door, leaving the only recovery a database
 * edit. Each forward step therefore has an explicit way back.
 *
 * Shared so the server can enforce the same rule the UI offers, rather than
 * trusting whatever status a client sends.
 */

export const FORWARD_FLOW = ["new", "packed", "shipped", "delivered", "completed"] as const;
export type OrderStatus = (typeof FORWARD_FLOW)[number] | "returned" | "cancelled";

/**
 * The status to step back to, or null when there is nowhere sensible to go.
 *
 * Terminal states (returned, cancelled) have no automatic reverse: undoing one
 * is a decision about a refund or a dispute, not a packing correction.
 */
export function previousStatus(current: string): string | null {
  const i = (FORWARD_FLOW as readonly string[]).indexOf(current);
  if (i <= 0) return null;
  return FORWARD_FLOW[i - 1];
}

/** Human label for the button, e.g. "Back to Packed". */
export function revertLabel(current: string): string | null {
  const prev = previousStatus(current);
  if (!prev) return null;
  return `Back to ${prev.charAt(0).toUpperCase()}${prev.slice(1)}`;
}

/**
 * Is this a legitimate transition? Forward one step, backward one step, or
 * into a terminal state, which can happen from anywhere.
 */
export function isAllowedTransition(from: string, to: string): boolean {
  if (from === to) return true;
  if (to === "returned" || to === "cancelled") return true;
  const flow = FORWARD_FLOW as readonly string[];
  const i = flow.indexOf(from);
  const j = flow.indexOf(to);
  // An unknown status must not silently block corrections — the eBay importer
  // can introduce states this flow doesn't model.
  if (i === -1 || j === -1) return true;
  return Math.abs(i - j) === 1;
}
