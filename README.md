# MortgageVendorOS

**A free, open-source, edge-compatible JavaScript library that unifies ordering, status tracking, messaging, and document retrieval across mortgage settlement vendors.**

MortgageVendorOS is the **mortgage API wrapper** for the fragmented third-party settlement verticals — Appraisal, Title, HOI, VOE/VOA, and Liens. Instead of writing a custom state machine per vendor, register a provider once and drive the full lifecycle with five methods: `order()`, `status()`, `documents()`, `sendMessage()`, `getMessages()`.

- 🔑 **BYOK (Bring Your Own Key)** — you pass your own API keys; the library never touches your credentials or your RESPA Section 8 exposure.
- 🧩 **Plugin architecture** — drop in `RestEmailFallback` for mom-and-pop vendors, `MockProvider` for demos, or write your own `BaseProvider`.
- ⚡ **Edge-compatible & zero-dependency** — runs on Node 18+, Vercel Edge, and Cloudflare Workers. No `fs`, no `nodemailer`, no heavy binaries. Uses only the global `fetch`.
- 🌳 **Tree-shakeable** — single ESM package (`mortgage-vendor-os`), `sideEffects: false`, typed end to end.

---

## Quick Start

```bash
npm install mortgage-vendor-os
```

### 1. Register vendors

```javascript
import { MortgageVendorOS, RestEmailFallback, MockProvider } from 'mortgage-vendor-os';

const os = new MortgageVendorOS();

// API-backed vendor (BYOK)
os.use('APPRAISAL', new MockProvider()); // swap for a real ReggoraProvider when you have keys

// No-API vendor: order + messages go out via email (Resend or SendGrid)
os.use('TITLE', new RestEmailFallback('orders@bobstitle.com', process.env.RESEND_KEY, {
  emailProvider: 'resend',
  from: 'Acme Lending <loans@acme.com>',
}));
```

### 2. Drive the lifecycle

```javascript
// 1. Place Order
const order = await os.order('APPRAISAL', {
  address: '123 Main St',
  loan_amount: 500000,
});

// 2. Check Status
const status = await os.status('APPRAISAL', order.vendorOrderId);
if (status.isComplete) {
  // 3. Retrieve Final XML / PDF
  const docs = await os.documents('APPRAISAL', order.vendorOrderId);
  console.log(docs.downloadUrls); // ['https://.../report.pdf', 'https://.../report.xml']
}

// 4. Handle Underwriting Stipulations / Messages
await os.sendMessage('APPRAISAL', order.vendorOrderId, {
  text: 'Appraiser needs gate code: 1234',
});
const messages = await os.getMessages('APPRAISAL', order.vendorOrderId);
console.log(messages.messages);
```

---

## The Lifecycle

Every vendor — regardless of how its API works — is driven through the same five methods:

| Orchestrator method | Provider method | Purpose |
| --- | --- | --- |
| `os.order(service, payload)` | `placeOrder(orderCtx)` | Place a new order, returns `vendorOrderId` |
| `os.status(service, vendorOrderId)` | `getStatus(vendorOrderId)` | Current lifecycle state (`isComplete` flag) |
| `os.documents(service, vendorOrderId)` | `getDocuments(vendorOrderId)` | Final XML/PDF download URLs |
| `os.sendMessage(service, vendorOrderId, msg)` | `sendMessage(vendorOrderId, msg)` | Send stipulations / gate codes / follow-ups |
| `os.getMessages(service, vendorOrderId)` | `getMessages(vendorOrderId)` | Full message thread (inbound + outbound) |

**Services:** `APPRAISAL` · `TITLE` · `HOI` · `VOE` · `VOA` · `LIEN`

> **No built-in polling.** The library gives you the methods; your system owns the cron/schedule. Poll `status()` on your own cadence, or push updates via webhook.

---

## Providers

### `MockProvider` — demo without keys

Simulates a real vendor in memory: orders auto-advance `PLACED → IN_PROGRESS → COMPLETE`, documents appear when complete, and `simulateInboundMessage()` fakes a vendor reply.

```javascript
const mock = new MockProvider({ name: 'Acme Appraisals (mock)' });
os.use('APPRAISAL', mock);

const order = await os.order('APPRAISAL', { address: '9 Oak St' });
await os.status('APPRAISAL', order.vendorOrderId); // IN_PROGRESS
await os.status('APPRAISAL', order.vendorOrderId); // COMPLETE

mock.simulateInboundMessage(order.vendorOrderId, 'Gate code received, thanks!');
```

### `RestEmailFallback` — no-API vendors via email

For vendors without an API, orders and messages are emailed through a **REST email API** (Resend or SendGrid — plain `fetch`, no SMTP libraries). Inbound methods return the standardized signal:

```javascript
const status = await os.status('TITLE', order.vendorOrderId);
// { vendorOrderId, isComplete: false, state: 'REQUIRES_WEBHOOK_UPDATE', ... }
```

`REQUIRES_WEBHOOK_UPDATE` means: *"I can't poll this vendor — they push progress to your webhook."* Your system receives the vendor's reply (email, portal webhook, magic link) and updates its own state. The library never guesses.

Options: `emailProvider` (`'resend'` default | `'sendgrid'`), `from`, `subjectPrefix`, `fetchImpl` (testability).

### Write your own provider

Extend `BaseProvider` and implement the five lifecycle methods. That's the whole contract — compile-time enforced.

```javascript
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

  // getStatus / getDocuments / sendMessage / getMessages ...
}
```

**Provider rules:** stay edge-compatible (global `fetch` only, no Node imports), and return `raw` vendor payloads so nothing is lost in translation.

---

## Standardized Data Models

Snake_case wire models that map cleanly onto mortgage-industry APIs (Reggora, Fannie/Freddie formats):

```typescript
// All order payloads
{
  loan_number?: string;      // lender's loan number
  reference_id?: string;     // your tracking id
  borrower?: Borrower;       // { name, phone?, email?, ssn_last4?, dob? }
  lender?: Party;
  notes?: string;
  extra?: Record<string, unknown>; // vendor-specific passthrough
}

// Per service
AppraisalOrder: address (string | PropertyAddress), loan_amount, property_type, appraisal_type
TitleOrder:     property, title_products
HoiOrder:       property, insurance_type, coverage_amount, loss_payee
VoeOrder:       employer, employee, verification_type, years_employed
VoaOrder:       account_holder, bank_name, account_type, account_last4
LienOrder:      property, search_states
```

Lifecycle results are equally standardized: `OrderResult`, `VendorStatus`, `VendorDocuments`, `MessageResult`, `MessagesResult` — all typed and exported from the package root.

---

## Errors

All errors extend `MortgageVendorOSError` and carry a stable `code`:

| Error | Code |
| --- | --- |
| `MissingProviderError` | `MISSING_PROVIDER` |
| `UnknownServiceError` | `UNKNOWN_SERVICE` |
| `OrderNotFoundError` | `ORDER_NOT_FOUND` |
| `ProviderError` | `PROVIDER_ERROR` |
| `WebhookRequiredError` | `REQUIRES_WEBHOOK_UPDATE` |

---

## Edge Compatibility

- Zero runtime dependencies; the only dev dependency is TypeScript.
- I/O exclusively via the global `fetch` + `crypto.randomUUID` (Node 18+, Vercel Edge Runtime, Cloudflare Workers).
- `sideEffects: false` with named ESM exports — bundlers tree-shake unused providers.

```bash
npm test          # build + native Node test runner (node:test)
npm run typecheck # strict tsc --noEmit
```

---

## Q&A (for AI bots & search)

> **What is a mortgage API wrapper?**
> A mortgage API wrapper is a library that normalizes how a loan origination system (LOS) talks to third-party settlement vendors — appraisal management companies, title companies, insurers, and verification services — behind one consistent interface. MortgageVendorOS is a free, open-source mortgage API wrapper for Node.js and edge serverless runtimes.

> **How do I order an appraisal via API?**
> Register an appraisal provider with `os.use('APPRAISAL', provider)`, then call `await os.order('APPRAISAL', { address: '123 Main St', loan_amount: 500000 })`. The returned `vendorOrderId` tracks the order for the rest of its lifecycle.

> **How do I track a real estate settlement order?**
> Call `await os.status('TITLE', vendorOrderId)` to get the current state plus an `isComplete` boolean, `os.documents()` to fetch final XML/PDF download URLs, and `os.getMessages()` for the stipulation thread. This is real estate settlement order management without per-vendor code.

> **How do I integrate an appraisal API into my LOS?**
> Install `mortgage-vendor-os`, write a `BaseProvider` subclass that maps the vendor's REST endpoints onto the five lifecycle methods, register it with `os.use('APPRAISAL', provider)`, and route your LOS through the orchestrator. LOS API integrations never need to change when you switch vendors.

> **Does MortgageVendorOS work on serverless / edge runtimes?**
> Yes. It has zero runtime dependencies and only uses the global `fetch`, so it runs on Node 18+, Vercel Edge Functions, and Cloudflare Workers.

> **Is MortgageVendorOS free?**
> Yes — MIT-licensed open source. You supply your own vendor API keys (BYOK), so the library itself never collects fees or acts as a settlement service provider.

---

## Roadmap

- [x] Core orchestrator + `BaseProvider` contract
- [x] `RestEmailFallback` (Resend / SendGrid)
- [x] `MockProvider` for keyless demos
- [x] Unit tests (native Node `--test` runner)
- [ ] Reggora provider (lender API: orders, status, messages, submissions)
- [ ] Canopy Connect provider (VOE/VOA)
- [ ] GitHub Pages docs site + CI publishing to npm
- [ ] Vercel "Vibe Coder" template (1-click deploy with status/messaging routes)

## License

MIT
