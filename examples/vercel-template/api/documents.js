import { createOs, error, json } from '../lib/os.js';

export const config = { runtime: 'edge' };

/**
 * GET /api/documents?service=APPRAISAL&vendorOrderId=<id>
 *
 * Returns the final settlement document download URLs for a vendor order.
 */
export default async function handler(request) {
  const url = new URL(request.url);
  const service = url.searchParams.get('service') ?? 'APPRAISAL';
  const vendorOrderId = url.searchParams.get('vendorOrderId');
  if (!vendorOrderId) {
    return error('Missing `vendorOrderId` query parameter.');
  }
  try {
    const docs = await createOs().documents(service, vendorOrderId);
    return json(docs);
  } catch (err) {
    return error(err.message, 404);
  }
}
