# AGENTS.md — MortgageVendorOS for AI coding agents

This file teaches AI coding agents (and humans) how to **build with
MortgageVendorOS** — wire appraisal, title, HOI, VOE/VOA, and lien vendors
into any Node.js or edge serverless app. It is written for consumers
integrating the library, not for maintaining the library itself. Keep it
short — every line pays rent.

---

## What MortgageVendorOS is

A **zero-dependency, edge-compatible JavaScript library** that unifies how a
loan origination system (LOS) talks to mortgage settlement vendors. Instead of
writing a bespoke integration per vendor, you register providers behind one
lifecycle API:

1. **`order()`** — place an order (appraisal, title, insurance, verification).
2. **`status()`** — poll lifecycle state until complete.
3. **`documents()`** — fetch final XML/PDF download URLs.
4. **`sendMessage()`** — send stipulations, gate codes, follow-ups.
5. **`getMessages()`** — read the message thread (inbound + outbound).

Six service types are built in: `APPRAISAL`, `TITLE`, `HOI`, `VOE`, `VOA`,
`LIEN`. BYOK — you supply your own vendor API keys; the library never touches
credentials or collects fees. Runs on Node 18+, Vercel Edge, and Cloudflare
Workers (global `fetch` only, no Node builtins).

---

## Quick start — register a provider, drive a lifecycle

```js
import { MortgageVendorOS, MockProvider, RestEmailFallback } from 'mortgage-vendor-os';

const os = new MortgageVendorOS();

// MockProvider: keyless, in-memory vendor for demos/tests. Orders auto-advance
// PLACED → IN_PROGRESS → COMPLETE as you poll status().
os.use('APPRAISAL', new MockProvider());

// RestEmailFallback: emails mom-and-pop vendors with no API via Resend/SendGrid.
os.use('TITLE', new RestEmailFallback('orders@bobstitle.com', process.env.RESEND_KEY));

// 1. Place an order
const order = await os.order('APPRAISAL', { address: '123 Main St', loan_amount: 500000 });

// 2. Poll status until complete
const status = await os.status('APPRAISAL', order.vendorOrderId);
if (status.isComplete) {
  // 3. Fetch final documents (PDF/XML download URLs)
  const docs = await os.documents('APPRAISAL', order.vendorOrderId);
  console.log(docs.downloadUrls);
}

// 4. Messaging (stipulations, gate codes)
await os.sendMessage('APPRAISAL', order.vendorOrderId, { text: 'Gate code: 1234' });
const thread = await os.getMessages('APPRAISAL', order.vendorOrderId);
```

That's it. No build step, no framework requirement, no per-vendor state machine.

---

## The orchestrator API

| Member | Signature | Purpose |
|---|---|---|
| `use(service, provider)` | `(ServiceType \| ServiceType[], BaseProvider) => this` | Register a provider for one or more services. Re-registering replaces the existing provider. |
| `remove(service)` | `(ServiceType) => this` | Unregister a provider. |
| `provider(service)` | `(ServiceType) => BaseProvider \| undefined` | Look up the registered provider. |
| `registrations()` | `() => ReadonlyMap<ServiceType, BaseProvider>` | All registrations (defensive copy). |
| `order(service, payload)` | `(ServiceType, OrderPayloadFor<S>) => Promise<OrderResult>` | Place an order. Returns `{ vendorOrderId, service_type, provider, status, created_at }`. |
| `status(service, vendorOrderId)` | `(ServiceType, string) => Promise<VendorStatus>` | `{ vendorOrderId, isComplete, state, detail, updated_at }`. |
| `documents(service, vendorOrderId)` | `(ServiceType, string) => Promise<VendorDocuments>` | `{ vendorOrderId, status, downloadUrls, documents }`. |
| `sendMessage(service, vendorOrderId, message)` | `(ServiceType, string, { text, subject?, attachments?, author? }) => Promise<MessageResult>` | `{ messageId, vendorOrderId, status, created_at }`. |
| `getMessages(service, vendorOrderId)` | `(ServiceType, string) => Promise<MessagesResult>` | `{ status, messages }` envelope. |

Service types: `'APPRAISAL' | 'TITLE' | 'HOI' | 'VOE' | 'VOA' | 'LIEN'`.

---

## Providers

### `MockProvider` — keyless demos and tests

```js
os.use('APPRAISAL', new MockProvider({ name: 'Acme Appraisals (mock)', statusChecksToComplete: 2 }));
```

- Orders auto-advance to `COMPLETE` after `statusChecksToComplete` status calls.
- `getDocuments()` returns sample PDF/XML URLs once complete, `PENDING` before.
- Terminal states (`COMPLETE`, `CANCELLED`, `FAILED`) are never overwritten.
- `simulateInboundMessage(vendorOrderId, text, author?)` fakes a vendor reply.
- `setState(vendorOrderId, state)` forces a state; `hasOrder(id)` checks existence.

### `ReggoraProvider` — real appraisal orders via Reggora

Reggora's Lender API (JWT + API-key auth) is mapped onto the lifecycle:

```js
import { MortgageVendorOS, ReggoraProvider } from 'mortgage-vendor-os';

const os = new MortgageVendorOS();
os.use('APPRAISAL', new ReggoraProvider(
  process.env.REGGORA_AUTH_TOKEN,
  process.env.REGGORA_INTEGRATION_KEY,
  { baseUrl: 'https://sandbox.reggora.io/lender/' } // omit for production
));

const order = await os.order('APPRAISAL', {
  address: '100 Brighton Ave',
  extra: {
    loan: '5c33c716681f110034effc73',       // Reggora loan file id (required)
    products: ['5b55d4c68d9472000fc432ef'], // Reggora product ids (required)
    priority: 'Rush',                        // 'Normal' | 'Rush'
    allocation_type: 'manually',             // defaults to 'automatically'
    vendors: ['5b859eebc5a0c9004e38dd8e'],  // required when 'manually'
    due_date: '2026-09-01T21:00:00Z',        // defaults to now + 14 days
  },
});
```

- `order()` → `POST /lender/order`; `status()` → `GET /lender/order/<id>`
  (Reggora status strings map to standardized states — `Submitted`/`Order
  Complete` → `COMPLETE`, `Cancelled` → `CANCELLED`).
- `documents()` → `GET /lender/order-submissions/<id>` (latest submission's
  `pdf_report`/`xml_report`/`invoice` URLs).
- `sendMessage()`/`getMessages()` resolve the order's `conversation` id, then
  `POST`/`GET /lender/conversation/<id>`.
- Reggora-specific fields travel through `payload.extra` (the standardized
  passthrough) since Reggora references loan files and products by id.

### `RestEmailFallback` — vendors with no API

```js
os.use('TITLE', new RestEmailFallback('orders@bobstitle.com', process.env.RESEND_KEY, {
  emailProvider: 'sendgrid',            // or 'resend' (default)
  from: 'Acme Lending <loans@acme.com>', // must be verified with the email provider
  subjectPrefix: '[Bob\'s Title Co]',
}));
```

- `placeOrder()` and `sendMessage()` send emails via Resend or SendGrid REST.
- `getStatus()`, `getDocuments()`, `getMessages()` return the standardized
  `REQUIRES_WEBHOOK_UPDATE` signal — this vendor has no API to poll, so the
  vendor pushes status back to **your** webhook endpoint instead.
- `options.fetchImpl` lets you inject a custom fetch (tests, exotic runtimes).

### Custom providers — write your own `BaseProvider`

The contract every plugin must satisfy (compile-time enforced):

```js
import { BaseProvider } from 'mortgage-vendor-os';

class MyVendor extends BaseProvider {
  constructor(key) { super('MyVendor'); this.key = key; }

  async placeOrder(orderCtx) { /* POST to vendor → return { vendorOrderId, service_type, provider, status, created_at } */ }
  async getStatus(vendorOrderId) { /* return { vendorOrderId, isComplete, state, detail, updated_at } */ }
  async getDocuments(vendorOrderId) { /* return { vendorOrderId, status, downloadUrls, documents } */ }
  async sendMessage(vendorOrderId, message) { /* return { messageId, vendorOrderId, status, created_at } */ }
  async getMessages(vendorOrderId) { /* return { status, messages } */ }
}

os.use('APPRAISAL', new MyVendor(process.env.MY_APPRAISAL_KEY));
```

`placeOrder` receives an `OrderContext` — `{ service_type, payload, meta }` —
so every plugin sees a consistent envelope. Payloads use **snake_case**
standardized models (`AppraisalOrder`, `TitleOrder`, `HoiOrder`, `VoeOrder`,
`VoaOrder`, `LienOrder`) that map onto real vendor APIs.

---

## How it behaves (know before you ship)

- **Errors are typed.** `MissingProviderError`, `UnknownServiceError`,
  `OrderNotFoundError`, `ProviderError`, `WebhookRequiredError` all extend
  `MortgageVendorOSError` with stable codes. Catch the base class, inspect
  `.code` / `.service` / `.vendorOrderId`.
- **`use()` validates providers** — passing something that doesn't extend
  `BaseProvider` throws a `TypeError` immediately, not deep inside a call.
- **`order()` requires a payload object**; `sendMessage()` requires non-empty
  `text`; `vendorOrderId` must be a non-empty string. Invalid input throws
  `TypeError` at the orchestrator boundary.
- **`getMessages()` returns an envelope** — `{ status, messages }`, not a bare
  array — so the `REQUIRES_WEBHOOK_UPDATE` signal is consistent across every
  inbound method.
- **Edge-compatible:** zero runtime dependencies, global `fetch` only. No
  `node:` imports, no SMTP libs. Tree-shakeable ESM with full TypeScript types.
- **`status()` is poll-based** — call it on your own cadence (there's no
  built-in scheduler). For `RestEmailFallback` vendors, build a webhook
  endpoint and let the vendor push updates to you.

---

## Common integration gotchas

- **Don't share the orchestrator across requests if you need isolation** — a
  single `MortgageVendorOS` instance is fine for most apps, but providers like
  `MockProvider` hold in-memory state. For stateless edge functions, keep
  providers keyed by order/tenant or persist state yourself.
- **`RestEmailFallback` can't be polled.** Its `getStatus`/`getDocuments`/
  `getMessages` return `REQUIRES_WEBHOOK_UPDATE`. If you call `status()` in a
  loop expecting progress, you'll get the same signal forever — build the
  webhook path instead.
- **`ReggoraProvider` needs Reggora ids, not property details.** Reggora's
  create-order endpoint references an existing loan file and product catalog
  by id — you must pass `extra.loan` and `extra.products`, or `placeOrder`
  throws a `ProviderError`. Property address/amount are informational.
- **Verified senders only.** Resend/SendGrid reject `from` addresses that
  aren't verified on the account. Use a verified domain or the provider's
  default `onboarding@` address in dev.
- **snake_case payloads.** The standardized models use snake_case
  (`loan_amount`, `property_type`, `ssn_last4`). Vendors with camelCase APIs
  are mapped inside the provider — your LOS-facing payloads stay snake_case.
- **`isComplete` is the flag to trust** for status, not `state` — providers
  may use vendor-specific state strings.

---

## Where to go from here

- Live home page: https://spuds0588.github.io/MortgageVendorOS/
- Repo: https://github.com/Spuds0588/MortgageVendorOS
- README with full API docs: https://github.com/Spuds0588/MortgageVendorOS#readme
- Examples: `test/` in the repo runs the full lifecycle with `node --test`
  (37 tests) — a great reference for expected shapes and error behavior.
