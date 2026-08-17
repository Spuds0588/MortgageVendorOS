# MortgageVendorOS — Documentation

Welcome to the MortgageVendorOS docs. Everything here is plain markdown in
the repo — no separate docs site to maintain.

**MortgageVendorOS** is a free, open-source, edge-compatible JavaScript
library that unifies ordering, status tracking, messaging, and document
retrieval across mortgage settlement vendors (Appraisal, Title, HOI, VOE/VOA,
Liens) behind one lifecycle API.

## Start here

| Doc | What's inside |
| --- | --- |
| [Getting Started](getting-started.md) | Install, register vendors, drive the full lifecycle end to end |
| [API Reference](api-reference.md) | Every orchestrator + provider method, signatures, and types |
| [Providers](providers.md) | `MockProvider`, `ReggoraProvider`, `RestEmailFallback`, and writing your own |
| [Data Models](data-models.md) | The standardized snake_case order payloads |
| [Errors](errors.md) | The error hierarchy and stable codes |
| [Deploying](deploying.md) | Node 18+, Vercel Edge, Cloudflare Workers, and the Vercel template |

## Cheat sheet

```js
import { MortgageVendorOS, MockProvider, ReggoraProvider, RestEmailFallback } from 'mortgage-vendor-os';

const os = new MortgageVendorOS();
os.use('APPRAISAL', new ReggoraProvider(process.env.REGGORA_AUTH_TOKEN, process.env.REGGORA_INTEGRATION_KEY));
os.use('TITLE', new RestEmailFallback('orders@bobstitle.com', process.env.RESEND_KEY));

const order = await os.order('APPRAISAL', { address: '123 Main St', loan_amount: 500000 });
const status = await os.status('APPRAISAL', order.vendorOrderId);
const docs = await os.documents('APPRAISAL', order.vendorOrderId);
await os.sendMessage('APPRAISAL', order.vendorOrderId, { text: 'Gate code: 1234' });
const thread = await os.getMessages('APPRAISAL', order.vendorOrderId);
```

- **Homepage:** <https://spuds0588.github.io/MortgageVendorOS/>
- **Try it live:** <https://npm.runkit.com/mortgage-vendor-os>
- **npm:** <https://www.npmjs.com/package/mortgage-vendor-os>
- **Repo:** <https://github.com/Spuds0588/MortgageVendorOS>
- **AGENTS.md** (for AI coding agents): [`../AGENTS.md`](../AGENTS.md)
- **Vercel template:** [`../examples/vercel-template/`](../examples/vercel-template/)
