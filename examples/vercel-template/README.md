# MortgageVendorOS — Vercel Template

A deploy-ready **MortgageVendorOS** app: order, status, documents, and
messaging routes running on **Vercel Edge Functions**, plus a minimal demo UI.
Bring your own vendor keys (BYOK) — or run it keyless on `MockProvider`.

## What's inside

| File | Purpose |
|---|---|
| `api/order.js` | `POST /api/order` — place an order `{ service, payload }` → `OrderResult` |
| `api/status.js` | `GET /api/status?service&vendorOrderId` → `VendorStatus` |
| `api/documents.js` | `GET /api/documents?service&vendorOrderId` → `VendorDocuments` |
| `api/messages.js` | `GET` (thread) / `POST` (send) `/api/messages` |
| `lib/os.js` | Env-driven provider setup (Reggora / email fallback / mock) |
| `public/` | Minimal demo UI wired to the API routes |
| `server.mjs` | Zero-dependency local dev server (no Vercel CLI needed) |

## Run locally

```bash
npm install
npm start        # http://localhost:3000
```

Open the demo, click **Place order**, then **Poll status** a couple of times —
the mock order advances `PLACED → IN_PROGRESS → COMPLETE`, then **Fetch
documents** returns sample PDF/XML URLs.

## Provider selection (env vars)

| Env var | Effect |
|---|---|
| `REGGORA_AUTH_TOKEN` + `REGGORA_INTEGRATION_KEY` | `APPRAISAL` uses real Reggora API |
| `REGGORA_SANDBOX=1` | Reggora hits `sandbox.reggora.io` instead of production |
| `RESEND_KEY` | `TITLE` orders/messages go out via Resend email |
| `TITLE_EMAIL` | Recipient for the email fallback (default `orders@bobstitle.com`) |
| `EMAIL_PROVIDER=sendgrid` | Use SendGrid instead of Resend |

Without any keys, every service falls back to `MockProvider` — the whole demo
runs keyless.

## Deploy to Vercel

Push this directory (or the whole repo) to GitHub, then:

1. Import the repo in Vercel — **Framework: Other**, build command empty,
   output directory empty.
2. Add any vendor secrets above as environment variables.
3. Deploy. The API routes run on the Edge Runtime; `/` serves the demo UI.

Once `mortgage-vendor-os` is published to npm, you can swap the `file:../..`
dependency in `package.json` for `"mortgage-vendor-os": "^0.1.0"` so the
template deploys standalone without the library repo.

## Example calls

```bash
# Place an appraisal order (keyless → MockProvider)
curl -X POST https://<your-app>.vercel.app/api/order \
  -H 'Content-Type: application/json' \
  -d '{"service":"APPRAISAL","payload":{"address":"100 Brighton Ave","loan_amount":500000}}'

# Poll status
curl "https://<your-app>.vercel.app/api/status?service=APPRAISAL&vendorOrderId=<id>"

# Fetch documents once complete
curl "https://<your-app>.vercel.app/api/documents?service=APPRAISAL&vendorOrderId=<id>"

# Send a message
curl -X POST https://<your-app>.vercel.app/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"service":"APPRAISAL","vendorOrderId":"<id>","message":{"text":"Gate code: 1234"}}'
```
