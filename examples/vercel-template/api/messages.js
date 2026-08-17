import { createOs, error, json, readBody } from '../lib/os.js';

export const config = { runtime: 'edge' };

/**
 * GET  /api/messages?service=APPRAISAL&vendorOrderId=<id>   → message thread
 * POST /api/messages                                       → send a message
 *      Body: { service, vendorOrderId, message: { text, subject?, author? } }
 */
export default async function handler(request) {
  const os = createOs();
  const url = new URL(request.url);
  const service = url.searchParams.get('service') ?? 'APPRAISAL';
  const vendorOrderId = url.searchParams.get('vendorOrderId');

  try {
    if (request.method === 'POST') {
      const body = await readBody(request);
      const id = body.vendorOrderId ?? vendorOrderId;
      if (!id) return error('Missing `vendorOrderId`.');
      if (!body.message?.text) return error('Message must include `text`.');
      const sent = await os.sendMessage(service, id, body.message);
      return json(sent, 201);
    }

    if (!vendorOrderId) {
      return error('Missing `vendorOrderId` query parameter.');
    }
    const thread = await os.getMessages(service, vendorOrderId);
    return json(thread);
  } catch (err) {
    return error(err.message, 404);
  }
}
