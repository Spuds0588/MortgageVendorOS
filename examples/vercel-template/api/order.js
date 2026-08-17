import { createOs, error, json, readBody } from '../lib/os.js';

export const config = { runtime: 'edge' };

/**
 * POST /api/order
 *
 * Body: { service: 'APPRAISAL' | 'TITLE' | ..., payload: { ... } }
 *
 * Places an order with the registered provider for `service` and returns the
 * standardized OrderResult (including `vendorOrderId`).
 */
export default async function handler(request) {
  if (request.method !== 'POST') {
    return error('Method not allowed. Use POST.', 405);
  }
  const { service, payload } = await readBody(request);
  if (!service || !payload) {
    return error('Body must include `service` and `payload`.');
  }
  try {
    const order = await createOs().order(service, payload);
    return json(order, 201);
  } catch (err) {
    return error(err.message, 400);
  }
}
