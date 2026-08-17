# Deploying

MortgageVendorOS has **zero runtime dependencies** and uses only the global
`fetch`, so it runs anywhere Node 18+ runs — plain servers, serverless
functions, and edge runtimes.

## Node 18+

```js
import { MortgageVendorOS, ReggoraProvider } from 'mortgage-vendor-os';

const os = new MortgageVendorOS();
os.use('APPRAISAL', new ReggoraProvider(
  process.env.REGGORA_AUTH_TOKEN,
  process.env.REGGORA_INTEGRATION_KEY
));

export async function handler(req) {
  // ... your server handler
}
```

## Vercel Edge Functions

```js
// api/order.js
import { createOs } from '../lib/os.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  const { service, payload } = await request.json();
  const order = await createOs().order(service, payload);
  return Response.json(order, { status: 201 });
}
```

## Cloudflare Workers

```js
import { MortgageVendorOS, MockProvider } from 'mortgage-vendor-os';

export default {
  async fetch(request, env) {
    const os = new MortgageVendorOS();
    os.use('APPRAISAL', new MockProvider());
    const url = new URL(request.url);
    // ... route to os.order / os.status / os.documents / ...
  },
};
```

The library never imports Node builtins (`fs`, `http`, `crypto`), so it
bundles cleanly for edge runtimes. A CI guard fails the build if a `node:`
import ever sneaks into `dist/`.

## Vercel "Vibe Coder" template

A deploy-ready app lives at [`examples/vercel-template/`](../examples/vercel-template/):

- `POST /api/order` · `GET /api/status` · `GET /api/documents` ·
  `GET+POST /api/messages`
- Env-driven provider selection (Reggora / Resend email fallback / keyless
  `MockProvider`)
- A minimal demo UI and a zero-dependency local dev server (`npm start`)

See its [README](../examples/vercel-template/README.md) for run + deploy
instructions.

## State across requests

`MockProvider` holds orders in memory. On stateless edge runtimes, either:

- Keep a module-level singleton (the template does this) so state survives
  across requests within an instance, **or**
- Persist orders to a KV store and back your provider with that storage for
  durability across cold starts and multiple instances.

Real providers like `ReggoraProvider` are stateless by nature — the vendor
holds the order; you just pass `vendorOrderId` around.
