// Shared MortgageVendorOS setup for the template.
//
// Provider selection is env-driven so the same deploy works keyless (demos)
// or with real vendors:
//
//   - APPRAISAL:
//       * ReggoraProvider when REGGORA_AUTH_TOKEN + REGGORA_INTEGRATION_KEY
//         are set (add REGGORA_SANDBOX=1 to hit the sandbox API).
//       * Otherwise MockProvider (keyless, auto-advances to COMPLETE).
//   - TITLE:
//       * RestEmailFallback when RESEND_KEY is set (add TITLE_EMAIL for the
//         recipient, e.g. orders@bobstitle.com).
//       * Otherwise MockProvider.
//
// The orchestrator is created per-request so stateless edge functions never
// share in-memory provider state across cold starts.

import {
  MortgageVendorOS,
  MockProvider,
  ReggoraProvider,
  RestEmailFallback,
} from 'mortgage-vendor-os';

function reggoraProvider() {
  const sandbox = process.env.REGGORA_SANDBOX === '1' || process.env.REGGORA_SANDBOX === 'true';
  return new ReggoraProvider(
    process.env.REGGORA_AUTH_TOKEN,
    process.env.REGGORA_INTEGRATION_KEY,
    { baseUrl: sandbox ? 'https://sandbox.reggora.io/lender/' : undefined }
  );
}

function titleProvider() {
  if (process.env.RESEND_KEY) {
    return new RestEmailFallback(
      process.env.TITLE_EMAIL ?? 'orders@bobstitle.com',
      process.env.RESEND_KEY,
      { emailProvider: process.env.EMAIL_PROVIDER === 'sendgrid' ? 'sendgrid' : 'resend' }
    );
  }
  return new MockProvider({ name: 'Title (mock)' });
}

// Module-level singleton so in-memory provider state (MockProvider orders,
// message threads) survives across requests within an instance. This makes
// the demo work end-to-end on the Edge Runtime. For production durability
// across cold starts / multiple instances, persist orders to a KV store (see
// README) and back the provider with that storage instead.
let cachedOs = null;

/** Build (once) an orchestrator with providers wired from the environment. */
export function createOs() {
  if (cachedOs) return cachedOs;
  const os = new MortgageVendorOS();

  if (process.env.REGGORA_AUTH_TOKEN && process.env.REGGORA_INTEGRATION_KEY) {
    os.use('APPRAISAL', reggoraProvider());
  } else {
    os.use('APPRAISAL', new MockProvider({ name: 'Appraisal (mock)' }));
  }

  os.use('TITLE', titleProvider());
  cachedOs = os;
  return os;
}

/** Standardized JSON helpers for Vercel Edge functions. */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

/** Read a JSON request body (safe for edge runtimes). */
export async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
