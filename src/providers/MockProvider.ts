import { BaseProvider } from '../core/BaseProvider.js';
import { OrderNotFoundError } from '../errors.js';
import { randomId } from '../internal/id.js';
import type {
  MessagePayload,
  MessageResult,
  MessagesResult,
  OrderContext,
  OrderPayload,
  OrderResult,
  VendorDocuments,
  VendorMessage,
  VendorStatus,
  VendorState,
} from '../types.js';

export interface MockProviderOptions {
  /** Display name of the mock vendor. Defaults to `'MockProvider'`. */
  name?: string;
  /**
   * Number of `getStatus()` calls before an order flips to `COMPLETE`.
   * Defaults to 2 (first call → IN_PROGRESS, second → COMPLETE).
   */
  statusChecksToComplete?: number;
}

interface MockOrder {
  vendorOrderId: string;
  orderCtx: OrderContext<OrderPayload>;
  state: VendorState;
  statusChecks: number;
  messages: VendorMessage[];
  createdAt: string;
}

const STATUS_CYCLE: readonly VendorState[] = ['PLACED', 'IN_PROGRESS', 'COMPLETE'];

const TERMINAL_STATES: ReadonlySet<VendorState> = new Set([
  'COMPLETE',
  'CANCELLED',
  'FAILED',
]);

const STATUS_DETAIL: Record<VendorState, string> = {
  PLACED: 'Order placed with mock vendor.',
  IN_PROGRESS: 'Mock vendor is processing the order.',
  COMPLETE: 'Order complete. Documents are ready for download.',
  CANCELLED: 'Order cancelled.',
  FAILED: 'Order failed.',
  REQUIRES_WEBHOOK_UPDATE: 'Mock provider does not use webhook updates.',
};

/**
 * An in-memory vendor that simulates the full lifecycle — perfect for demos,
 * local development, and tests before you have real sandbox API keys.
 *
 * Orders auto-advance PLACED → IN_PROGRESS → COMPLETE as you poll
 * `getStatus()`. Once complete, `getDocuments()` returns sample PDF/XML
 * download URLs. Use `simulateInboundMessage()` to fake a vendor reply and
 * exercise the messaging lifecycle.
 *
 * ```ts
 * const os = new MortgageVendorOS();
 * os.use('APPRAISAL', new MockProvider({ name: 'Acme Appraisals (mock)' }));
 * ```
 */
export class MockProvider extends BaseProvider {
  private readonly orders = new Map<string, MockOrder>();
  private readonly statusChecksToComplete: number;

  constructor(options: MockProviderOptions = {}) {
    super(options.name ?? 'MockProvider');
    this.statusChecksToComplete = Math.max(
      1,
      options.statusChecksToComplete ?? 2
    );
  }

  async placeOrder(orderCtx: OrderContext<OrderPayload>): Promise<OrderResult> {
    const vendorOrderId = randomId();
    this.orders.set(vendorOrderId, {
      vendorOrderId,
      orderCtx,
      state: 'PLACED',
      statusChecks: 0,
      messages: [],
      createdAt: orderCtx.meta.requested_at,
    });
    return {
      vendorOrderId,
      service_type: orderCtx.service_type,
      provider: this.name,
      status: 'PLACED',
      created_at: orderCtx.meta.requested_at,
    };
  }

  async getStatus(vendorOrderId: string): Promise<VendorStatus> {
    const order = this.requireOrder(vendorOrderId);
    order.statusChecks += 1;
    // Terminal states are never overwritten by auto-advance. Otherwise the
    // order reaches COMPLETE after `statusChecksToComplete` status checks.
    if (!TERMINAL_STATES.has(order.state)) {
      const index =
        order.statusChecks >= this.statusChecksToComplete ? 2 : 1;
      order.state = STATUS_CYCLE[index]!;
    }
    return {
      vendorOrderId,
      isComplete: order.state === 'COMPLETE',
      state: order.state,
      detail: STATUS_DETAIL[order.state],
      updated_at: new Date().toISOString(),
    };
  }

  async getDocuments(vendorOrderId: string): Promise<VendorDocuments> {
    const order = this.requireOrder(vendorOrderId);
    if (order.state !== 'COMPLETE') {
      return {
        vendorOrderId,
        status: 'PENDING',
        downloadUrls: [],
        documents: [],
      };
    }
    return {
      vendorOrderId,
      status: 'AVAILABLE',
      downloadUrls: [
        `https://mock.vendor.example/orders/${vendorOrderId}/report.pdf`,
        `https://mock.vendor.example/orders/${vendorOrderId}/report.xml`,
      ],
      documents: [
        {
          name: 'Appraisal Report (PDF)',
          type: 'PDF',
          downloadUrl: `https://mock.vendor.example/orders/${vendorOrderId}/report.pdf`,
        },
        {
          name: 'Appraisal Report (XML)',
          type: 'XML',
          downloadUrl: `https://mock.vendor.example/orders/${vendorOrderId}/report.xml`,
        },
      ],
    };
  }

  async sendMessage(
    vendorOrderId: string,
    message: MessagePayload
  ): Promise<MessageResult> {
    const order = this.requireOrder(vendorOrderId);
    order.messages.push({
      id: randomId(),
      vendorOrderId,
      direction: 'OUTBOUND',
      author: message.author,
      text: message.text,
      created_at: new Date().toISOString(),
    });
    return {
      messageId: randomId(),
      vendorOrderId,
      status: 'SENT',
      created_at: new Date().toISOString(),
    };
  }

  async getMessages(vendorOrderId: string): Promise<MessagesResult> {
    const order = this.requireOrder(vendorOrderId);
    return {
      status: 'AVAILABLE',
      messages: order.messages,
    };
  }

  /** Simulate the vendor replying (inbound message) for demo/testing. */
  simulateInboundMessage(
    vendorOrderId: string,
    text: string,
    author = 'Mock Vendor'
  ): VendorMessage {
    const order = this.requireOrder(vendorOrderId);
    const message: VendorMessage = {
      id: randomId(),
      vendorOrderId,
      direction: 'INBOUND',
      author,
      text,
      created_at: new Date().toISOString(),
    };
    order.messages.push(message);
    return message;
  }

  /** Forcibly set an order's lifecycle state (demo/helper). */
  setState(vendorOrderId: string, state: VendorState): void {
    const order = this.requireOrder(vendorOrderId);
    order.state = state;
  }

  /** True when the provider knows about this order. */
  hasOrder(vendorOrderId: string): boolean {
    return this.orders.has(vendorOrderId);
  }

  private requireOrder(vendorOrderId: string): MockOrder {
    const order = this.orders.get(vendorOrderId);
    if (!order) {
      throw new OrderNotFoundError(vendorOrderId, this.name);
    }
    return order;
  }

}
