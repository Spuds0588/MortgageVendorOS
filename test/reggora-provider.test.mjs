import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MortgageVendorOS,
  ProviderError,
  ReggoraProvider,
} from '../dist/index.js';

const AUTH = 'jwt-token-123';
const INTEGRATION = 'integration-key-456';

/** Build a provider whose fetch hits a router keyed by (url, method). */
function makeProvider(routes, { baseUrl = 'https://sandbox.reggora.io/lender/' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url}`;
    calls.push({ url, method, init });
    const route = routes[key];
    if (!route) {
      return jsonResponse(404, { detail: `no route for ${key}` });
    }
    if (typeof route === 'function') return route();
    return jsonResponse(200, route);
  };
  const provider = new ReggoraProvider(AUTH, INTEGRATION, { baseUrl, fetchImpl });
  return { provider, calls };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORDER_ID = '5c2e718cb61f76001adf9871';
const CONVERSATION_ID = '5c4f16764672bb00105ea5f9';

const SAMPLE_ORDER = {
  data: {
    order: {
      id: ORDER_ID,
      status: 'Inspection Scheduled',
      created: '2019-01-03T20:33:16.748Z',
      conversation: CONVERSATION_ID,
    },
  },
  status: 200,
};

test('placeOrder POSTs the mapped body and returns the Reggora order id', async () => {
  const { provider, calls } = makeProvider({
    'POST https://sandbox.reggora.io/lender/order': { data: ORDER_ID, status: 200 },
  });

  const result = await provider.placeOrder({
    service_type: 'APPRAISAL',
    payload: {
      address: '100 Brighton Ave',
      loan_amount: 500000,
      extra: {
        loan: '5c33c716681f110034effc73',
        products: ['5b55d4c68d9472000fc432ef'],
        priority: 'Rush',
        allocation_type: 'manually',
        vendors: ['5b859eebc5a0c9004e38dd8e'],
        order_request_method: 'individually',
        additional_fees: [{ description: 'Large yard', amount: '50' }],
      },
    },
    meta: { requested_at: '2026-01-01T00:00:00Z' },
  });

  assert.equal(result.vendorOrderId, ORDER_ID);
  assert.equal(result.status, 'SUBMITTED');
  assert.equal(result.provider, 'ReggoraProvider');

  const call = calls[0];
  assert.equal(call.url, 'https://sandbox.reggora.io/lender/order');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, `Bearer ${AUTH}`);
  assert.equal(call.init.headers.integration, INTEGRATION);

  const body = JSON.parse(call.init.body);
  assert.equal(body.allocation_type, 'manually');
  assert.deepEqual(body.vendors, ['5b859eebc5a0c9004e38dd8e']);
  assert.equal(body.loan, '5c33c716681f110034effc73');
  assert.equal(body.priority, 'Rush');
  assert.deepEqual(body.products, ['5b55d4c68d9472000fc432ef']);
  assert.equal(body.order_request_method, 'individually');
  assert.deepEqual(body.additional_fees, [{ description: 'Large yard', amount: '50' }]);
  assert.ok(body.due_date, 'due_date should be present');
});

test('placeOrder defaults allocation_type/priority and omits vendors when automatic', async () => {
  const { provider, calls } = makeProvider({
    'POST https://sandbox.reggora.io/lender/order': { data: ORDER_ID, status: 200 },
  });

  await provider.placeOrder({
    service_type: 'APPRAISAL',
    payload: {
      address: '100 Brighton Ave',
      extra: { loan: 'loan-1', products: ['prod-1'] },
    },
    meta: { requested_at: '2026-01-01T00:00:00Z' },
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.allocation_type, 'automatically');
  assert.equal(body.priority, 'Normal');
  assert.equal('vendors' in body, false, 'vendors omitted for automatic allocation');
});

test('placeOrder validates required Reggora fields', async () => {
  const { provider } = makeProvider({});
  await assert.rejects(
    provider.placeOrder({
      service_type: 'APPRAISAL',
      payload: { address: 'x', extra: { products: ['p1'] } },
      meta: { requested_at: 'x' },
    }),
    (err) =>
      err instanceof ProviderError && /extra\.loan/.test(err.message),
    'missing loan should throw'
  );

  await assert.rejects(
    provider.placeOrder({
      service_type: 'APPRAISAL',
      payload: { address: 'x', extra: { loan: 'l1', products: [] } },
      meta: { requested_at: 'x' },
    }),
    (err) =>
      err instanceof ProviderError && /extra\.products/.test(err.message),
    'empty products should throw'
  );

  await assert.rejects(
    provider.placeOrder({
      service_type: 'APPRAISAL',
      payload: {
        address: 'x',
        extra: { loan: 'l1', products: ['p1'], allocation_type: 'manually' },
      },
      meta: { requested_at: 'x' },
    }),
    (err) =>
      err instanceof ProviderError && /extra\.vendors/.test(err.message),
    'manual allocation without vendors should throw'
  );
});

test('getStatus maps Reggora status strings to standardized states', async () => {
  const cases = [
    ['Inspection Scheduled', 'IN_PROGRESS', false],
    ['Ordered', 'IN_PROGRESS', false],
    ['Submitted', 'COMPLETE', true],
    ['Order Complete', 'COMPLETE', true],
    ['Cancelled', 'CANCELLED', false],
  ];

  for (const [reggoraStatus, expectedState, expectedComplete] of cases) {
    const { provider } = makeProvider({
      [`GET https://sandbox.reggora.io/lender/order/${ORDER_ID}`]: {
        data: { order: { id: ORDER_ID, status: reggoraStatus } },
        status: 200,
      },
    });
    const status = await provider.getStatus(ORDER_ID);
    assert.equal(status.vendorOrderId, ORDER_ID);
    assert.equal(status.state, expectedState, `status "${reggoraStatus}"`);
    assert.equal(status.isComplete, expectedComplete, `status "${reggoraStatus}"`);
  }
});

test('getDocuments returns PENDING when no submissions exist', async () => {
  const { provider } = makeProvider({
    [`GET https://sandbox.reggora.io/lender/order-submissions/${ORDER_ID}`]: {
      data: { submissions: [] },
      status: 200,
    },
  });
  const docs = await provider.getDocuments(ORDER_ID);
  assert.equal(docs.status, 'PENDING');
  assert.deepEqual(docs.downloadUrls, []);
});

test('getDocuments maps the latest submission report URLs', async () => {
  const pdf = `https://sandbox.reggora.io/lender/order-submission/${ORDER_ID}/1/pdf_report`;
  const xml = `https://sandbox.reggora.io/lender/order-submission/${ORDER_ID}/1/xml_report`;
  const { provider } = makeProvider({
    [`GET https://sandbox.reggora.io/lender/order-submissions/${ORDER_ID}`]: {
      data: {
        submissions: [
          { version: 1, pdf_report: pdf, xml_report: xml, invoice: null },
        ],
      },
      status: 200,
    },
  });
  const docs = await provider.getDocuments(ORDER_ID);
  assert.equal(docs.status, 'AVAILABLE');
  assert.deepEqual(docs.downloadUrls, [pdf, xml]);
  assert.equal(docs.documents.length, 2);
  assert.equal(docs.documents[0].type, 'PDF');
  assert.equal(docs.documents[1].type, 'XML');
});

test('sendMessage resolves the conversation id, then posts the message', async () => {
  const { provider, calls } = makeProvider({
    [`GET https://sandbox.reggora.io/lender/order/${ORDER_ID}`]: SAMPLE_ORDER,
    [`POST https://sandbox.reggora.io/lender/conversation/${CONVERSATION_ID}`]: {
      data: 'msg-789',
      status: 200,
    },
  });

  const result = await provider.sendMessage(ORDER_ID, { text: 'Gate code: 1234' });
  assert.equal(result.messageId, 'msg-789');
  assert.equal(result.vendorOrderId, ORDER_ID);
  assert.equal(result.status, 'SENT');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.includes(`order/${ORDER_ID}`), true);
  assert.equal(calls[1].url.includes(`conversation/${CONVERSATION_ID}`), true);
  assert.equal(JSON.parse(calls[1].init.body).message, 'Gate code: 1234');
});

test('getMessages maps the conversation thread to VendorMessages', async () => {
  const { provider } = makeProvider({
    [`GET https://sandbox.reggora.io/lender/order/${ORDER_ID}`]: SAMPLE_ORDER,
    [`GET https://sandbox.reggora.io/lender/conversation/${CONVERSATION_ID}`]: {
      data: {
        conversation: {
          id: CONVERSATION_ID,
          messages: [
            {
              id: 'm1',
              message: 'Hey this is a message',
              sender: { id: 's1', name: 'John Smith' },
              sent_time: '2018-04-19T15:02:02.157Z',
            },
          ],
        },
      },
      status: 200,
    },
  });

  const result = await provider.getMessages(ORDER_ID);
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].text, 'Hey this is a message');
  assert.equal(result.messages[0].author, 'John Smith');
  assert.equal(result.messages[0].direction, 'INBOUND');
  assert.equal(result.messages[0].vendorOrderId, ORDER_ID);
});

test('HTTP failures surface as ProviderError with status detail', async () => {
  const { provider } = makeProvider({
    [`GET https://sandbox.reggora.io/lender/order/${ORDER_ID}`]: { detail: 'nope' },
  });
  // Force a 500 by overriding status via a custom route
  const fetchImpl = async () =>
    new Response(JSON.stringify({ detail: 'boom' }), { status: 500 });
  const failing = new ReggoraProvider(AUTH, INTEGRATION, { fetchImpl });

  await assert.rejects(
    failing.getStatus(ORDER_ID),
    (err) => err instanceof ProviderError && /HTTP 500/.test(err.message)
  );
});

test('works end-to-end through the MortgageVendorOS orchestrator', async () => {
  const { provider, calls } = makeProvider({
    'POST https://sandbox.reggora.io/lender/order': { data: ORDER_ID, status: 200 },
    [`GET https://sandbox.reggora.io/lender/order/${ORDER_ID}`]: {
      data: { order: { id: ORDER_ID, status: 'Submitted', conversation: CONVERSATION_ID } },
      status: 200,
    },
    [`GET https://sandbox.reggora.io/lender/order-submissions/${ORDER_ID}`]: {
      data: { submissions: [{ version: 1, pdf_report: 'https://example.com/r.pdf' }] },
      status: 200,
    },
  });

  const os = new MortgageVendorOS();
  os.use('APPRAISAL', provider);

  const order = await os.order('APPRAISAL', {
    address: '100 Brighton Ave',
    extra: { loan: 'loan-1', products: ['prod-1'] },
  });
  assert.equal(order.vendorOrderId, ORDER_ID);

  const status = await os.status('APPRAISAL', order.vendorOrderId);
  assert.equal(status.isComplete, true);

  const docs = await os.documents('APPRAISAL', order.vendorOrderId);
  assert.equal(docs.status, 'AVAILABLE');
  assert.deepEqual(docs.downloadUrls, ['https://example.com/r.pdf']);
  assert.ok(calls.length >= 3, 'expected at least 3 network calls');
});
