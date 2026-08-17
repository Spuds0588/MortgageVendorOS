# Providers

MortgageVendorOS ships three providers and lets you write your own. Each is a
`BaseProvider` subclass — swap them without touching your LOS code.

## `MockProvider` — keyless demos and tests

Simulates a real vendor in memory. Orders auto-advance
`PLACED → IN_PROGRESS → COMPLETE` as you poll; documents appear once complete;
`simulateInboundMessage()` fakes a vendor reply.

```js
const mock = new MockProvider({ name: 'Acme Appraisals (mock)', statusChecksToComplete: 2 });
os.use('APPRAISAL', mock);

const order = await os.order('APPRAISAL', { address: '9 Oak St' });
await os.status('APPRAISAL', order.vendorOrderId); // IN_PROGRESS
await os.status('APPRAISAL', order.vendorOrderId); // COMPLETE

mock.simulateInboundMessage(order.vendorOrderId, 'Gate code received, thanks!');
```

Notes:

- Terminal states (`COMPLETE`, `CANCELLED`, `FAILED`) are never overwritten by
  auto-advance.
- `setState(id, state)` forces a state; `hasOrder(id)` checks existence.
- State is in-memory — it does not survive a process restart or multiple
  instances. Use a real provider (or persist state) in production.

## `ReggoraProvider` — real appraisal orders

Maps Reggora's Lender API (orders, order-submissions, conversations) onto the
lifecycle. Auth is JWT + integration key via the `Authorization` and
`integration` headers.

```js
os.use('APPRAISAL', new ReggoraProvider(
  process.env.REGGORA_AUTH_TOKEN,      // JWT
  process.env.REGGORA_INTEGRATION_KEY, // integration key
  { baseUrl: 'https://sandbox.reggora.io/lender/' } // omit for production
));
```

Reggora references an existing loan file and product catalog **by id**, so
those travel through the standardized `extra` passthrough:

```js
const order = await os.order('APPRAISAL', {
  address: '100 Brighton Ave',
  loan_amount: 500000,
  extra: {
    loan: '5c33c716681f110034effc73',       // Reggora loan file id (required)
    products: ['5b55d4c68d9472000fc432ef'], // Reggora product ids (required)
    priority: 'Rush',                        // 'Normal' | 'Rush'
    allocation_type: 'manually',             // defaults to 'automatically'
    vendors: ['5b859eebc5a0c9004e38dd8e'],  // required when 'manually'
    order_request_method: 'individually',    // 'individually' | 'broadcast'
    due_date: '2026-09-01T21:00:00Z',        // defaults to now + 14 days
    additional_fees: [{ description: 'Large yard', amount: '50' }],
  },
});
```

Behavior:

- **Status mapping** — Reggora status strings map to standardized states:
  `Submitted`/`Order Complete` → `COMPLETE`, `Cancelled` → `CANCELLED`,
  everything else → `IN_PROGRESS`.
- **Documents** — pulls the latest submission version's `pdf_report` /
  `xml_report` / `invoice` URLs.
- **Messaging** — resolves the order's `conversation` id, then reads/posts to
  `/lender/conversation/<id>`.
- **Errors** — `placeOrder` throws `ProviderError` if `extra.loan` or
  `extra.products` is missing, or if `allocation_type: 'manually'` lacks
  `extra.vendors`.
- **Options** — `baseUrl` (sandbox vs production), `fetchImpl` (testability).

## `RestEmailFallback` — no-API vendors via email

For mom-and-pop vendors with no API, orders and messages are emailed through a
REST email API (Resend or SendGrid — plain `fetch`, no SMTP libraries).

```js
os.use('TITLE', new RestEmailFallback('orders@bobstitle.com', process.env.RESEND_KEY, {
  emailProvider: 'sendgrid',             // or 'resend' (default)
  from: 'Acme Lending <loans@acme.com>', // must be verified with the provider
  subjectPrefix: "[Bob's Title Co]",
}));
```

Inbound methods return the standardized signal:

```js
const status = await os.status('TITLE', order.vendorOrderId);
// { vendorOrderId, isComplete: false, state: 'REQUIRES_WEBHOOK_UPDATE', ... }
```

`REQUIRES_WEBHOOK_UPDATE` means *"I can't poll this vendor — they push progress
to your webhook."* Build a webhook endpoint and let the vendor (or an email
integration like a magic-link flow) push updates to you.

Options: `emailProvider`, `from`, `subjectPrefix`, `fetchImpl`.

## Write your own provider

Extend `BaseProvider` and implement the five lifecycle methods — that's the
whole contract, compile-time enforced.

```js
import { BaseProvider } from 'mortgage-vendor-os';

class MyVendorProvider extends BaseProvider {
  constructor(apiKey) {
    super('MyVendor');
    this.apiKey = apiKey;
  }

  async placeOrder(orderCtx) {
    const res = await fetch('https://api.myvendor.com/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(orderCtx.payload),
    });
    const json = await res.json();
    return {
      vendorOrderId: json.order_id,
      service_type: orderCtx.service_type,
      provider: this.name,
      status: 'PLACED',
      created_at: orderCtx.meta.requested_at,
      raw: json,
    };
  }

  async getStatus(vendorOrderId) { /* ... */ }
  async getDocuments(vendorOrderId) { /* ... */ }
  async sendMessage(vendorOrderId, message) { /* ... */ }
  async getMessages(vendorOrderId) { /* ... */ }
}

os.use('APPRAISAL', new MyVendorProvider(process.env.MY_KEY));
```

**Provider rules:**

- Stay edge-compatible: global `fetch` only, no Node-only imports (`fs`,
  `http`, `nodemailer`).
- Return `raw` vendor payloads so nothing is lost in translation.
- Return `{ status, messages }` envelopes from `getMessages` (not a bare array).
