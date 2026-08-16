import { BaseProvider } from '../core/BaseProvider.js';
import { ProviderError } from '../errors.js';
import { randomId } from '../internal/id.js';
import type {
  MessagePayload,
  MessageResult,
  MessagesResult,
  OrderContext,
  OrderPayload,
  OrderResult,
  PropertyAddress,
  VendorDocuments,
  VendorStatus,
} from '../types.js';

/** Email delivery backends supported by RestEmailFallback (both plain REST). */
export type EmailProvider = 'resend' | 'sendgrid';

export interface RestEmailFallbackOptions {
  /** Email API to use. Defaults to `'resend'`. */
  emailProvider?: EmailProvider;
  /**
   * The `from` address. Required by both Resend and SendGrid; must be a
   * verified sender for the respective account.
   */
  from?: string;
  /** Prefix added to every subject line, e.g. `'[Bob\'s Title Co]'`. */
  subjectPrefix?: string;
  /**
   * Inject a custom fetch implementation (useful for tests and exotic edge
   * runtimes). Defaults to the global `fetch`.
   */
  fetchImpl?: typeof fetch;
}

const RESEND_URL = 'https://api.resend.com/emails';
const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

const FIELD_LABELS: Record<string, string> = {
  loan_number: 'Loan #',
  reference_id: 'Reference ID',
  address: 'Property',
  loan_amount: 'Loan Amount',
  property_type: 'Property Type',
  appraisal_type: 'Appraisal Type',
  title_products: 'Title Products',
  insurance_type: 'Insurance Type',
  coverage_amount: 'Coverage Amount',
  loss_payee: 'Loss Payee',
  verification_type: 'Verification Type',
  years_employed: 'Years Employed',
  bank_name: 'Bank',
  account_type: 'Account Type',
  account_last4: 'Account Last 4',
  search_states: 'Search States',
  notes: 'Notes',
  employer: 'Employer',
  employee: 'Employee',
  account_holder: 'Account Holder',
  property: 'Property',
};

const WEBHOOK_DETAIL =
  'This provider has no API and cannot be polled. Status updates are pushed ' +
  'to your webhook endpoint. See the RestEmailFallback docs for the magic-link pattern.';

/**
 * A provider for "mom-and-pop" vendors that have no API: orders and messages
 * are sent as emails through a REST email API (Resend or SendGrid), and
 * inbound methods (`getStatus`, `getDocuments`, `getMessages`) return the
 * standardized `REQUIRES_WEBHOOK_UPDATE` signal — the vendor pushes progress
 * back to your system via webhook instead.
 *
 * Zero-dependency and edge-compatible: uses only the global `fetch` and
 * `crypto.randomUUID`.
 *
 * ```ts
 * const os = new MortgageVendorOS();
 * os.use('TITLE', new RestEmailFallback('orders@bobstitle.com', process.env.RESEND_KEY, {
 *   emailProvider: 'resend',
 *   from: 'Acme Lending <loans@acme.com>',
 * }));
 * ```
 */
export class RestEmailFallback extends BaseProvider {
  readonly toEmail: string;
  readonly apiKey: string;
  readonly options: Required<Pick<RestEmailFallbackOptions, 'emailProvider' | 'from' | 'subjectPrefix'>> &
    Pick<RestEmailFallbackOptions, 'fetchImpl'>;

  constructor(toEmail: string, apiKey: string, options: RestEmailFallbackOptions = {}) {
    super(`RestEmailFallback:${options.emailProvider ?? 'resend'}`);
    if (!toEmail || typeof toEmail !== 'string') {
      throw new TypeError('RestEmailFallback requires a recipient `toEmail`.');
    }
    if (!apiKey || typeof apiKey !== 'string') {
      throw new TypeError('RestEmailFallback requires an email API `apiKey`.');
    }
    this.toEmail = toEmail;
    this.apiKey = apiKey;
    this.options = {
      emailProvider: options.emailProvider ?? 'resend',
      from: options.from ?? 'MortgageVendorOS <onboarding@resend.dev>',
      subjectPrefix: options.subjectPrefix ?? '',
      fetchImpl: options.fetchImpl,
    };
  }

  async placeOrder(orderCtx: OrderContext<OrderPayload>): Promise<OrderResult> {
    const vendorOrderId = randomId();
    const { service_type, payload, meta } = orderCtx;
    const subject = [
      this.options.subjectPrefix,
      `New ${service_type} order ${vendorOrderId}`,
    ]
      .filter(Boolean)
      .join(' ');

    const body = renderOrderEmail(orderCtx, vendorOrderId);
    const raw = await this.sendEmail(subject, body);

    return {
      vendorOrderId,
      service_type,
      provider: this.name,
      status: 'PLACED',
      created_at: meta.requested_at,
      raw,
    };
  }

  async getStatus(vendorOrderId: string): Promise<VendorStatus> {
    return {
      vendorOrderId,
      isComplete: false,
      state: 'REQUIRES_WEBHOOK_UPDATE',
      detail: WEBHOOK_DETAIL,
    };
  }

  async getDocuments(vendorOrderId: string): Promise<VendorDocuments> {
    return {
      vendorOrderId,
      status: 'REQUIRES_WEBHOOK_UPDATE',
      downloadUrls: [],
      documents: [],
    };
  }

  async sendMessage(
    vendorOrderId: string,
    message: MessagePayload
  ): Promise<MessageResult> {
    if (typeof vendorOrderId !== 'string' || vendorOrderId.trim() === '') {
      throw new TypeError('vendorOrderId must be a non-empty string.');
    }
    const subject = [
      this.options.subjectPrefix,
      `Re: ${vendorOrderId}`,
      message.subject ? `— ${message.subject}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const lines = [message.text];
    if (message.attachments?.length) {
      lines.push('');
      lines.push('Attachments:');
      for (const a of message.attachments) {
        lines.push(`  - ${a.name ?? '(unnamed)'}${a.url ? ` (${a.url})` : ''}`);
      }
    }
    if (message.author) {
      lines.push('');
      lines.push(`From: ${message.author}`);
    }

    const raw = await this.sendEmail(subject, lines.join('\n'));

    return {
      messageId: randomId(),
      vendorOrderId,
      status: 'SENT',
      created_at: new Date().toISOString(),
      raw,
    };
  }

  async getMessages(vendorOrderId: string): Promise<MessagesResult> {
    return {
      status: 'REQUIRES_WEBHOOK_UPDATE',
      messages: [],
    };
  }

  // ------------------------------------------------------------------ //

  private async sendEmail(subject: string, body: string): Promise<unknown> {
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new ProviderError(
        'No fetch implementation available. Provide `options.fetchImpl` or run in an environment with global fetch (Node 18+, Vercel Edge, Cloudflare Workers).'
      );
    }

    const { emailProvider, from } = this.options;
    const request =
      emailProvider === 'sendgrid'
        ? buildSendGridRequest(this.toEmail, from, subject, body, this.apiKey)
        : buildResendRequest(this.toEmail, from, subject, body, this.apiKey);

    let response: Response;
    try {
      response = await fetchImpl(request.url, request.init);
    } catch (cause) {
      throw new ProviderError(
        `Email request to ${emailProvider} failed: ${(cause as Error).message}`,
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
        `Email provider ${emailProvider} returned HTTP ${response.status}: ${JSON.stringify(payload)}`
      );
    }
    return payload;
  }
}

// ---------------------------------------------------------------------- //
// Wire formats                                                            //
// ---------------------------------------------------------------------- //

function buildResendRequest(
  to: string,
  from: string,
  subject: string,
  body: string,
  apiKey: string
): { url: string; init: RequestInit } {
  return {
    url: RESEND_URL,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, text: body }),
    },
  };
}

function buildSendGridRequest(
  to: string,
  from: string,
  subject: string,
  body: string,
  apiKey: string
): { url: string; init: RequestInit } {
  return {
    url: SENDGRID_URL,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [{ type: 'text/plain', value: body }],
      }),
    },
  };
}

// ---------------------------------------------------------------------- //
// Email body rendering                                                    //
// ---------------------------------------------------------------------- //

function renderOrderEmail(
  orderCtx: OrderContext<OrderPayload>,
  vendorOrderId: string
): string {
  const { service_type, payload, meta } = orderCtx;
  const lines: string[] = [
    `${service_type} ORDER — please process and confirm receipt.`,
    '',
    `Order ID: ${vendorOrderId}`,
    `Placed: ${meta.requested_at}`,
  ];

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'extra') continue;

    const label = FIELD_LABELS[key] ?? humanize(key);
    lines.push(`${label}: ${formatValue(value)}`);
  }

  if (payload.extra && Object.keys(payload.extra).length > 0) {
    lines.push('');
    lines.push('Additional details:');
    for (const [key, value] of Object.entries(payload.extra)) {
      lines.push(`  ${humanize(key)}: ${JSON.stringify(value)}`);
    }
  }

  return lines.join('\n');
}

/** Keys rendered bare (no `key: ` prefix) for party-like objects. */
const PARTY_PLAIN_KEYS = new Set(['name', 'phone', 'email']);

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => formatValue(v)).join(', ');
  }
  if (isPropertyAddress(value)) {
    const head = [value.street, value.unit, value.city].filter(Boolean).join(', ');
    return `${head}, ${value.state} ${value.zip}`;
  }
  if (isPlainObject(value)) {
    // Render every scalar field of the object (parties, employers, generic
    // nested data) instead of dropping fields or printing [object Object].
    const parts: string[] = [];
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'object') continue;
      parts.push(
        PARTY_PLAIN_KEYS.has(key) ? String(v) : `${humanize(key)}: ${String(v)}`
      );
    }
    return parts.join(' | ');
  }
  if (typeof value === 'number' && value > 1000) {
    return formatMoney(value);
  }
  return String(value);
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2') // last4 → last 4
    .replace(/\bssn\b/gi, 'SSN')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPropertyAddress(value: unknown): value is PropertyAddress {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PropertyAddress).street === 'string' &&
    typeof (value as PropertyAddress).zip === 'string'
  );
}

// ---------------------------------------------------------------------- //
// Utilities                                                               //
// ---------------------------------------------------------------------- //

