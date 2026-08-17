import { BaseProvider } from '../core/BaseProvider.js';
import { ProviderError } from '../errors.js';
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

/**
 * Options for the Reggora provider.
 */
export interface ReggoraProviderOptions {
  /**
   * Base URL for the Reggora Lender API. Defaults to the production
   * `https://api.reggora.io/lender/`. Use `https://sandbox.reggora.io/lender/`
   * for sandbox testing.
   */
  baseUrl?: string;
  /**
   * Inject a custom fetch implementation (useful for tests and exotic edge
   * runtimes). Defaults to the global `fetch`.
   */
  fetchImpl?: typeof fetch;
}

/** Reggora order priority. */
export type ReggoraPriority = 'Normal' | 'Rush';
/** Reggora allocation mode. */
export type ReggoraAllocationType = 'automatically' | 'manually';
/** Reggora order request method. */
export type ReggoraOrderRequestMethod = 'individually' | 'broadcast';

/**
 * Reggora-specific fields read from `payload.extra` when placing an order.
 *
 * Reggora's create-order endpoint references an existing loan file and product
 * catalog by id rather than taking free-form property details, so those ids
 * travel through the standardized `extra` passthrough.
 */
export interface ReggoraOrderExtra {
  /** Id of the loan file in Reggora (required). */
  loan: string;
  /** List of Reggora product ids to order (required). */
  products: string[];
  /** Reggora vendor ids, in assignment order. Required when `allocation_type` is `'manually'`. */
  vendors?: string[];
  /** Defaults to `'automatically'`. */
  allocation_type?: ReggoraAllocationType;
  /** Defaults to `'Normal'`. */
  priority?: ReggoraPriority;
  /** Defaults to `'individually'`. */
  order_request_method?: ReggoraOrderRequestMethod;
  /** Due date in ISO UTC format. Defaults to now + 14 days. */
  due_date?: string;
  /** Additional fees `[{ description, amount }]`. */
  additional_fees?: Array<{ description: string; amount: string }>;
}

const PROD_BASE_URL = 'https://api.reggora.io/lender/';

/**
 * Maps Reggora's `order.status` string onto the standardized VendorState.
 *
 * Reggora statuses are free-form strings ("Ordered", "Inspection Scheduled",
 * "Submitted", "Order Complete", "Cancelled", ...). We match on keywords so a
 * new status label never hard-fails: anything containing "cancel" is
 * CANCELLED, anything containing "submitted"/"complete"/"delivered" is
 * COMPLETE, everything else is IN_PROGRESS.
 */
/**
 * Infer a document type from its URL. Reggora report URLs end in path
 * segments like `pdf_report`, `xml_report`, or `invoice`, so we scan the last
 * path segment (and extension) rather than only checking the extension.
 */
function documentType(url: string): 'PDF' | 'XML' | 'OTHER' {
  const tail = (url.split('?')[0] ?? '').toLowerCase();
  if (tail.endsWith('.xml') || tail.includes('xml')) return 'XML';
  if (tail.endsWith('.pdf') || tail.includes('pdf')) return 'PDF';
  return 'OTHER';
}

function mapReggoraState(status: string): VendorState {
  const s = status.toLowerCase();
  if (s.includes('cancel')) return 'CANCELLED';
  if (s.includes('submitted') || s.includes('complete') || s.includes('delivered')) {
    return 'COMPLETE';
  }
  return 'IN_PROGRESS';
}

/**
 * A provider for Reggora's appraisal platform — the real-world `APPRAISAL`
 * plugin. Uses Reggora's Lender API (JWT + API-key auth via the
 * `Authorization` and `integration` headers) to place orders, poll status,
 * fetch submitted reports, and message the vendor.
 *
 * Zero-dependency and edge-compatible: uses only the global `fetch`.
 *
 * ```ts
 * import { MortgageVendorOS, ReggoraProvider } from 'mortgage-vendor-os';
 *
 * const os = new MortgageVendorOS();
 * os.use('APPRAISAL', new ReggoraProvider(
 *   process.env.REGGORA_AUTH_TOKEN,
 *   process.env.REGGORA_INTEGRATION_KEY,
 *   { baseUrl: 'https://sandbox.reggora.io/lender/' }
 * ));
 *
 * const order = await os.order('APPRAISAL', {
 *   address: '100 Brighton Ave',
 *   loan_amount: 500000,
 *   extra: {
 *     loan: '5c33c716681f110034effc73',          // Reggora loan file id
 *     products: ['5b55d4c68d9472000fc432ef'],    // Reggora product ids
 *     priority: 'Rush',
 *   },
 * });
 * ```
 */
export class ReggoraProvider extends BaseProvider {
  readonly authToken: string;
  readonly integrationKey: string;
  readonly baseUrl: string;
  readonly options: Pick<ReggoraProviderOptions, 'fetchImpl'>;

  constructor(
    authToken: string,
    integrationKey: string,
    options: ReggoraProviderOptions = {}
  ) {
    super('ReggoraProvider');
    if (!authToken || typeof authToken !== 'string') {
      throw new TypeError('ReggoraProvider requires an `authToken` (JWT).');
    }
    if (!integrationKey || typeof integrationKey !== 'string') {
      throw new TypeError('ReggoraProvider requires an `integrationKey`.');
    }
    this.authToken = authToken;
    this.integrationKey = integrationKey;
    this.baseUrl = (options.baseUrl ?? PROD_BASE_URL).replace(/\/+$/, '') + '/';
    this.options = { fetchImpl: options.fetchImpl };
  }

  async placeOrder(orderCtx: OrderContext<OrderPayload>): Promise<OrderResult> {
    const { service_type, payload, meta } = orderCtx;
    const extra = (payload.extra ?? {}) as Partial<ReggoraOrderExtra>;

    if (!extra.loan || typeof extra.loan !== 'string') {
      throw new ProviderError(
        'ReggoraProvider.placeOrder requires `payload.extra.loan` (the Reggora loan file id).'
      );
    }
    if (!Array.isArray(extra.products) || extra.products.length === 0) {
      throw new ProviderError(
        'ReggoraProvider.placeOrder requires `payload.extra.products` (a non-empty list of Reggora product ids).'
      );
    }

    const allocationType = extra.allocation_type ?? 'automatically';
    if (allocationType === 'manually' && (!Array.isArray(extra.vendors) || extra.vendors.length === 0)) {
      throw new ProviderError(
        'ReggoraProvider.placeOrder requires `payload.extra.vendors` when `allocation_type` is "manually".'
      );
    }

    const dueDate =
      extra.due_date ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const body: Record<string, unknown> = {
      allocation_type: allocationType,
      loan: extra.loan,
      priority: extra.priority ?? 'Normal',
      products: extra.products,
      due_date: dueDate,
    };
    if (allocationType === 'manually') body.vendors = extra.vendors;
    if (extra.order_request_method) body.order_request_method = extra.order_request_method;
    if (extra.additional_fees?.length) body.additional_fees = extra.additional_fees;

    const raw = await this.request('order', { method: 'POST', body });
    const vendorOrderId = (raw as { data?: unknown })?.data;
    if (typeof vendorOrderId !== 'string' || !vendorOrderId) {
      throw new ProviderError(
        `Reggora create-order returned no order id: ${JSON.stringify(raw)}`
      );
    }

    return {
      vendorOrderId,
      service_type,
      provider: this.name,
      status: 'SUBMITTED',
      created_at: meta.requested_at,
      raw,
    };
  }

  async getStatus(vendorOrderId: string): Promise<VendorStatus> {
    const raw = await this.request(`order/${vendorOrderId}`);
    const order = (raw as { data?: { order?: Record<string, unknown> } })?.data?.order;
    const reggoraStatus =
      typeof order?.status === 'string' ? order.status : 'Unknown';
    const state = mapReggoraState(reggoraStatus);

    return {
      vendorOrderId,
      isComplete: state === 'COMPLETE',
      state,
      detail: `Reggora status: ${reggoraStatus}`,
      updated_at: typeof order?.created === 'string' ? order.created : undefined,
      raw,
    };
  }

  async getDocuments(vendorOrderId: string): Promise<VendorDocuments> {
    const raw = await this.request(`order-submissions/${vendorOrderId}`);
    const submissions = (raw as { data?: { submissions?: Array<Record<string, unknown>> } })
      ?.data?.submissions;

    if (!Array.isArray(submissions) || submissions.length === 0) {
      return {
        vendorOrderId,
        status: 'PENDING',
        downloadUrls: [],
        documents: [],
        raw,
      };
    }

    // Use the latest submission version for the report URLs.
    const latest = submissions[submissions.length - 1]!;
    const downloadUrls = [
      typeof latest.pdf_report === 'string' ? latest.pdf_report : undefined,
      typeof latest.xml_report === 'string' ? latest.xml_report : undefined,
      typeof latest.invoice === 'string' ? latest.invoice : undefined,
    ].filter((u): u is string => Boolean(u));

    const documents = downloadUrls.map((url) => ({
      name: url.split('/').pop()?.split('?')[0] ?? 'report',
      type: documentType(url),
      downloadUrl: url,
    }));

    return {
      vendorOrderId,
      status: 'AVAILABLE',
      downloadUrls,
      documents,
      raw,
    };
  }

  async sendMessage(
    vendorOrderId: string,
    message: MessagePayload
  ): Promise<MessageResult> {
    const conversationId = await this.conversationIdFor(vendorOrderId);
    const raw = await this.request(`conversation/${conversationId}`, {
      method: 'POST',
      body: { message: message.text },
    });
    const messageId = (raw as { data?: unknown })?.data;
    return {
      messageId: typeof messageId === 'string' ? messageId : conversationId,
      vendorOrderId,
      status: 'SENT',
      created_at: new Date().toISOString(),
      raw,
    };
  }

  async getMessages(vendorOrderId: string): Promise<MessagesResult> {
    const conversationId = await this.conversationIdFor(vendorOrderId);
    const raw = await this.request(`conversation/${conversationId}`);
    const messages = (raw as { data?: { conversation?: { messages?: unknown[] } } })
      ?.data?.conversation?.messages;

    const normalized: VendorMessage[] = Array.isArray(messages)
      ? messages.map((m) => {
          const msg = m as {
            id?: unknown;
            message?: unknown;
            sender?: { id?: unknown; name?: unknown };
            sent_time?: unknown;
          };
          return {
            id: typeof msg.id === 'string' ? msg.id : conversationId,
            vendorOrderId,
            direction: 'INBOUND',
            author: typeof msg.sender?.name === 'string' ? msg.sender.name : undefined,
            text: typeof msg.message === 'string' ? msg.message : '',
            created_at: typeof msg.sent_time === 'string' ? msg.sent_time : new Date().toISOString(),
            raw: msg,
          };
        })
      : [];

    return {
      status: 'AVAILABLE',
      messages: normalized,
      raw,
    };
  }

  // ------------------------------------------------------------------ //

  /** Fetch the conversation id for an order (Reggora links the two). */
  private async conversationIdFor(vendorOrderId: string): Promise<string> {
    const raw = await this.request(`order/${vendorOrderId}`);
    const conversation = (raw as { data?: { order?: { conversation?: unknown } } })
      ?.data?.order?.conversation;
    if (typeof conversation !== 'string' || !conversation) {
      throw new ProviderError(
        `Reggora order ${vendorOrderId} has no conversation id.`
      );
    }
    return conversation;
  }

  private async request(
    path: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<unknown> {
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new ProviderError(
        'No fetch implementation available. Provide `options.fetchImpl` or run in an environment with global fetch (Node 18+, Vercel Edge, Cloudflare Workers).'
      );
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.authToken}`,
      integration: this.integrationKey,
      'Content-Type': 'application/json',
    };

    let response: Response;
    try {
      response = await fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch (cause) {
      throw new ProviderError(
        `Reggora request to ${path} failed: ${(cause as Error).message}`,
        cause
      );
    }

    let payload: unknown = null;
    const text = await response.text();
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }

    if (!response.ok) {
      throw new ProviderError(
        `Reggora returned HTTP ${response.status} for ${path}: ${JSON.stringify(payload)}`
      );
    }
    return payload;
  }
}
