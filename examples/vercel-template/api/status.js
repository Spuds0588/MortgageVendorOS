import { createOs, error, json } from '../lib/os.js';

export const config = { runtime: 'edge' };

/**
 * GET /api/status?service=APPRAISAL&vendorOrderId=<id>
 *
 * Returns the current lifecycle status for a vendor order.
 */
export default async function handler(request) {
  const url = new URL(request.url);
  const service = url.searchParams.get('service') ?? 'APPRAISAL';
  const vendorOrderId = url.searchParams.get('vendorOrderId');
  if (!vendorOrderId) {
    return error('Missing `vendorOrderId` query parameter.');
  }
  try {
    const status = await createOs().status(service, vendorOrderId);
    return json(status);
  } catch (err) {
    return error(err.message, 404);
  }
}
