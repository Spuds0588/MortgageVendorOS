import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProviderError, RestEmailFallback } from '../dist/index.js';

/** Build a stub fetch that records requests and returns a canned response. */
function stubFetch({ status = 200, body = { id: 'email-1' } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

test('placeOrder() sends a Resend email and returns a PLACED order', async () => {
  const { fetchImpl, calls } = stubFetch();
  const provider = new RestEmailFallback('orders@bobstitle.com', 're_123', {
    fetchImpl,
    from: 'Acme Lending <loans@acme.com>',
    subjectPrefix: '[Acme]',
  });

  const result = await provider.placeOrder({
    service_type: 'APPRAISAL',
    payload: {
      address: '123 Main St',
      loan_amount: 500_000,
      borrower: { name: 'Jane Doe', email: 'jane@example.com' },
      loan_number: 'LN-1001',
    },
    meta: { requested_at: '2026-08-16T00:00:00.000Z' },
  });

  assert.equal(result.status, 'PLACED');
  assert.equal(result.provider, 'RestEmailFallback:resend');
  assert.equal(result.service_type, 'APPRAISAL');
  assert.match(result.vendorOrderId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(result.raw, { id: 'email-1' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');

  const headers = calls[0].init.headers;
  assert.equal(headers.Authorization, 'Bearer re_123');
  assert.equal(headers['Content-Type'], 'application/json');

  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.from, 'Acme Lending <loans@acme.com>');
  assert.deepEqual(sent.to, ['orders@bobstitle.com']);
  assert.match(sent.subject, /^\[Acme\] New APPRAISAL order /);
  assert.match(sent.text, /Order ID: /);
  assert.match(sent.text, /Jane Doe/);
  assert.match(sent.text, /123 Main St/);
  assert.match(sent.text, /\$500,000/);
  assert.match(sent.text, /LN-1001/);
});

test('placeOrder() renders a structured property address', async () => {
  const { fetchImpl, calls } = stubFetch();
  const provider = new RestEmailFallback('orders@bobstitle.com', 're_123', { fetchImpl });

  await provider.placeOrder({
    service_type: 'TITLE',
    payload: {
      property: {
        street: '9 Oak St',
        unit: '2B',
        city: 'Denver',
        state: 'CO',
        zip: '80202',
      },
    },
    meta: { requested_at: '2026-08-16T00:00:00.000Z' },
  });

  const sent = JSON.parse(calls[0].init.body);
  assert.match(sent.subject, /New TITLE order /);
  assert.match(sent.text, /9 Oak St, 2B, Denver, CO 80202/);
});

test('sendgrid provider builds the SendGrid v3 wire format', async () => {
  const { fetchImpl, calls } = stubFetch();
  const provider = new RestEmailFallback('orders@vendor.com', 'SG.key', {
    emailProvider: 'sendgrid',
    fetchImpl,
  });

  const result = await provider.sendMessage('order-77', {
    text: 'Appraiser needs gate code: 1234',
  });

  assert.equal(result.status, 'SENT');
  assert.equal(result.vendorOrderId, 'order-77');
  assert.equal(calls[0].url, 'https://api.sendgrid.com/v3/mail/send');

  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent.personalizations[0].to, [{ email: 'orders@vendor.com' }]);
  assert.equal(sent.from.email, 'MortgageVendorOS <onboarding@resend.dev>');
  assert.match(sent.subject, /Re: order-77/);
  assert.equal(sent.content[0].type, 'text/plain');
  assert.match(sent.content[0].value, /gate code: 1234/);
});

test('sendMessage() includes subject and attachments in the email', async () => {
  const { fetchImpl, calls } = stubFetch();
  const provider = new RestEmailFallback('orders@bobstitle.com', 're_123', { fetchImpl });

  await provider.sendMessage('order-99', {
    text: 'Please use the attached sketch.',
    subject: 'Property sketch',
    author: 'Jane Doe',
    attachments: [{ name: 'sketch.pdf', url: 'https://files.example/sketch.pdf' }],
  });

  const sent = JSON.parse(calls[0].init.body);
  assert.match(sent.subject, /^Re: order-99 — Property sketch$/);
  assert.match(sent.text, /sketch\.pdf \(https:\/\/files\.example\/sketch\.pdf\)/);
  assert.match(sent.text, /From: Jane Doe/);
});

test('inbound methods return the REQUIRES_WEBHOOK_UPDATE signal', async () => {
  const provider = new RestEmailFallback('orders@bobstitle.com', 're_123');

  const status = await provider.getStatus('order-1');
  assert.equal(status.state, 'REQUIRES_WEBHOOK_UPDATE');
  assert.equal(status.isComplete, false);
  assert.match(status.detail, /webhook/);

  const docs = await provider.getDocuments('order-1');
  assert.equal(docs.status, 'REQUIRES_WEBHOOK_UPDATE');
  assert.deepEqual(docs.downloadUrls, []);

  const messages = await provider.getMessages('order-1');
  assert.equal(messages.status, 'REQUIRES_WEBHOOK_UPDATE');
  assert.deepEqual(messages.messages, []);
});

test('non-2xx email responses throw ProviderError with the code', async () => {
  const { fetchImpl } = stubFetch({ status: 401, body: { message: 'unauthorized' } });
  const provider = new RestEmailFallback('orders@bobstitle.com', 'bad_key', { fetchImpl });

  await assert.rejects(
    provider.placeOrder({
      service_type: 'TITLE',
      payload: { property: { street: '1 Elm St', city: 'Denver', state: 'CO', zip: '80202' } },
      meta: { requested_at: '2026-08-16T00:00:00.000Z' },
    }),
    (err) =>
      err instanceof ProviderError &&
      err.code === 'PROVIDER_ERROR' &&
      /401/.test(err.message)
  );
});

test('transport failures are wrapped in ProviderError', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED');
  };
  const provider = new RestEmailFallback('orders@bobstitle.com', 're_123', { fetchImpl });

  await assert.rejects(
    provider.placeOrder({
      service_type: 'HOI',
      payload: { property: { street: '1 Elm St', city: 'Denver', state: 'CO', zip: '80202' } },
      meta: { requested_at: '2026-08-16T00:00:00.000Z' },
    }),
    (err) => err instanceof ProviderError && /ECONNREFUSED/.test(err.message)
  );
});

test('constructor validates recipient and api key', () => {
  assert.throws(() => new RestEmailFallback('', 'key'), TypeError);
  assert.throws(() => new RestEmailFallback('a@b.com', ''), TypeError);
});

test('email body renders every scalar field of nested objects', async () => {
  const { fetchImpl, calls } = stubFetch();
  const provider = new RestEmailFallback('orders@bobstitle.com', 're_123', { fetchImpl });

  await provider.placeOrder({
    service_type: 'VOE',
    payload: {
      employer: { name: 'Acme Inc', address: '123 Corp Way' },
      employee: { name: 'Jane Doe', ssn_last4: '4321', dob: '1990-01-01' },
      verification_type: 'FULL',
    },
    meta: { requested_at: '2026-08-16T00:00:00.000Z' },
  });

  const sent = JSON.parse(calls[0].init.body);
  assert.match(sent.text, /Acme Inc \| Address: 123 Corp Way/);
  assert.match(sent.text, /Jane Doe \| SSN Last 4: 4321 \| Dob: 1990-01-01/);
  assert.doesNotMatch(sent.text, /\[object Object\]/);
});

test('email body renders generic nested objects without [object Object]', async () => {
  const { fetchImpl, calls } = stubFetch();
  const provider = new RestEmailFallback('orders@bobstitle.com', 're_123', { fetchImpl });

  await provider.placeOrder({
    service_type: 'APPRAISAL',
    payload: {
      address: '123 Main St',
      extra: { rush: true, client_ref: 'abc-123' },
    },
    meta: { requested_at: '2026-08-16T00:00:00.000Z' },
  });

  const sent = JSON.parse(calls[0].init.body);
  assert.match(sent.text, /Rush: true/);
  assert.match(sent.text, /Client Ref: "abc-123"/);
  assert.doesNotMatch(sent.text, /\[object Object\]/);
});

test('sendMessage validates vendorOrderId when used directly', async () => {
  const provider = new RestEmailFallback('orders@bobstitle.com', 're_123');
  await assert.rejects(provider.sendMessage('', { text: 'hi' }), TypeError);
  await assert.rejects(provider.sendMessage('  ', { text: 'hi' }), TypeError);
});

test('attachments without a name render a fallback label', async () => {
  const { fetchImpl, calls } = stubFetch();
  const provider = new RestEmailFallback('orders@bobstitle.com', 're_123', { fetchImpl });

  await provider.sendMessage('order-1', {
    text: 'sketch attached',
    attachments: [{ url: 'https://files.example/sketch.pdf' }],
  });

  const sent = JSON.parse(calls[0].init.body);
  assert.match(sent.text, /\(unnamed\) \(https:\/\/files\.example\/sketch\.pdf\)/);
});
