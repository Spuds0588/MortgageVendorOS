# Getting Started

Install, register vendors, and drive the full lifecycle end to end.

## 1. Install

```bash
npm install mortgage-vendor-os
```

Zero runtime dependencies. Requires Node 18+ (or any runtime with the global
`fetch` — Vercel Edge, Cloudflare Workers).

## 2. Register vendors

```js
import { MortgageVendorOS, MockProvider, RestEmailFallback } from 'mortgage-vendor-os';

const os = new MortgageVendorOS();

// Keyless in-memory vendor for demos/tests — orders auto-advance to COMPLETE.
os.use('APPRAISAL', new MockProvider());

// No-API vendor: orders + messages go out via email (Resend or SendGrid).
os.use('TITLE', new RestEmailFallback('orders@bobstitle.com', process.env.RESEND_KEY, {
  emailProvider: 'resend',
  from: 'Acme Lending <loans@acme.com>',
}));
```

`use()` accepts a service (or an array of services) and a `BaseProvider`
subclass. Re-registering a service replaces its provider — handy for failover
and tests.

## 3. Drive the lifecycle

Five methods cover every vendor:

```js
// 1. Place an order → returns a vendorOrderId that tracks it forever.
const order = await os.order('APPRAISAL', {
  address: '123 Main St',
  loan_amount: 500000,
});

// 2. Poll status on your own cadence. `isComplete` is the flag to trust.
const status = await os.status('APPRAISAL', order.vendorOrderId);
if (status.isComplete) {
  // 3. Fetch the final XML/PDF download URLs.
  const docs = await os.documents('APPRAISAL', order.vendorOrderId);
  console.log(docs.downloadUrls);
}

// 4. Send stipulations / gate codes / follow-ups.
await os.sendMessage('APPRAISAL', order.vendorOrderId, {
  text: 'Appraiser needs gate code: 1234',
});

// 5. Read the message thread (inbound + outbound).
const thread = await os.getMessages('APPRAISAL', order.vendorOrderId);
```

There is **no built-in polling scheduler** — your system owns the cron or
webhook. For vendors with no API (`RestEmailFallback`), `getStatus` /
`getDocuments` / `getMessages` return `REQUIRES_WEBHOOK_UPDATE`, meaning the
vendor pushes progress to your webhook instead.

## Next steps

- See every method signature in the [API Reference](api-reference.md).
- Pick a provider in [Providers](providers.md).
- Understand the payloads in [Data Models](data-models.md).
- Deploy on the edge in [Deploying](deploying.md).
