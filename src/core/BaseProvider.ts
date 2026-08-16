import type {
  MessagePayload,
  MessageResult,
  MessagesResult,
  OrderContext,
  OrderPayload,
  OrderResult,
  VendorDocuments,
  VendorStatus,
} from '../types.js';

/**
 * The contract every MortgageVendorOS plugin must satisfy.
 *
 * Subclass this and implement all five lifecycle methods:
 *
 *   placeOrder    → os.order(...)
 *   getStatus     → os.status(...)
 *   getDocuments  → os.documents(...)
 *   sendMessage   → os.sendMessage(...)
 *   getMessages   → os.getMessages(...)
 *
 * The abstract class enforces the contract at compile time, and the
 * orchestrator enforces it at runtime — a provider that never registers all
 * five methods will simply fail to typecheck.
 *
 * Providers must stay edge-compatible: no Node-only imports (`fs`, `http`,
 * `nodemailer`). Use the global `fetch` for all I/O.
 */
export abstract class BaseProvider {
  /** Stable, human-readable provider name surfaced in results. */
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /** Place a new order with the vendor. Returns the vendor's order id. */
  abstract placeOrder(orderCtx: OrderContext<OrderPayload>): Promise<OrderResult>;

  /** Fetch the current lifecycle status for an order. */
  abstract getStatus(vendorOrderId: string): Promise<VendorStatus>;

  /** Fetch the final settlement documents (XML/PDF download URLs). */
  abstract getDocuments(vendorOrderId: string): Promise<VendorDocuments>;

  /** Send a message (stipulation, gate code, follow-up) to the vendor. */
  abstract sendMessage(
    vendorOrderId: string,
    message: MessagePayload
  ): Promise<MessageResult>;

  /** Retrieve the message thread (inbound + outbound) for an order. */
  abstract getMessages(vendorOrderId: string): Promise<MessagesResult>;
}
