import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MockProvider, OrderNotFoundError } from '../dist/index.js';

function ctx(overrides = {}) {
  return {
    service_type: 'APPRAISAL',
    payload: { address: '123 Main St' },
    meta: { requested_at: '2026-08-16T00:00:00.000Z' },
    ...overrides,
  };
}

test('orders auto-advance to COMPLETE as status is polled', async () => {
  const provider = new MockProvider();
  const placed = await provider.placeOrder(ctx());

  const s1 = await provider.getStatus(placed.vendorOrderId);
  assert.equal(s1.state, 'IN_PROGRESS');
  assert.equal(s1.isComplete, false);

  const s2 = await provider.getStatus(placed.vendorOrderId);
  assert.equal(s2.state, 'COMPLETE');
  assert.equal(s2.isComplete, true);
});

test('statusChecksToComplete is configurable', async () => {
  const provider = new MockProvider({ statusChecksToComplete: 1 });
  const placed = await provider.placeOrder(ctx());

  const s1 = await provider.getStatus(placed.vendorOrderId);
  assert.equal(s1.state, 'COMPLETE');
});

test('documents are PENDING until complete, then AVAILABLE with URLs', async () => {
  const provider = new MockProvider();
  const placed = await provider.placeOrder(ctx());

  const pending = await provider.getDocuments(placed.vendorOrderId);
  assert.equal(pending.status, 'PENDING');
  assert.deepEqual(pending.downloadUrls, []);

  await provider.getStatus(placed.vendorOrderId);
  await provider.getStatus(placed.vendorOrderId);

  const available = await provider.getDocuments(placed.vendorOrderId);
  assert.equal(available.status, 'AVAILABLE');
  assert.equal(available.downloadUrls.length, 2);
  assert.ok(available.downloadUrls[0].endsWith('.pdf'));
  assert.ok(available.downloadUrls[1].endsWith('.xml'));
  assert.equal(available.documents.length, 2);
});

test('messages round-trip: outbound send + simulated inbound reply', async () => {
  const provider = new MockProvider();
  const placed = await provider.placeOrder(ctx());

  const sent = await provider.sendMessage(placed.vendorOrderId, {
    text: 'Appraiser needs gate code: 1234',
  });
  assert.equal(sent.status, 'SENT');

  const inbound = provider.simulateInboundMessage(
    placed.vendorOrderId,
    'Gate code received, thanks!',
    'Acme Appraisals'
  );
  assert.equal(inbound.direction, 'INBOUND');

  const thread = await provider.getMessages(placed.vendorOrderId);
  assert.equal(thread.status, 'AVAILABLE');
  assert.equal(thread.messages.length, 2);
  assert.equal(thread.messages[0].direction, 'OUTBOUND');
  assert.equal(thread.messages[1].direction, 'INBOUND');
  assert.equal(thread.messages[1].author, 'Acme Appraisals');
  assert.ok(thread.messages.every((m) => m.id && m.created_at));
});

test('unknown vendor order ids throw OrderNotFoundError', async () => {
  const provider = new MockProvider();

  await assert.rejects(
    provider.getStatus('nope'),
    (err) => err instanceof OrderNotFoundError && err.code === 'ORDER_NOT_FOUND'
  );
  await assert.rejects(provider.getDocuments('nope'), OrderNotFoundError);
  await assert.rejects(provider.sendMessage('nope', { text: 'hi' }), OrderNotFoundError);
  await assert.rejects(provider.getMessages('nope'), OrderNotFoundError);
  assert.throws(() => provider.simulateInboundMessage('nope', 'hi'), OrderNotFoundError);
  assert.throws(() => provider.setState('nope', 'COMPLETE'), OrderNotFoundError);
  assert.equal(provider.hasOrder('nope'), false);
});

test('setState() forces a lifecycle state', async () => {
  const provider = new MockProvider();
  const placed = await provider.placeOrder(ctx());

  provider.setState(placed.vendorOrderId, 'CANCELLED');
  const status = await provider.getStatus(placed.vendorOrderId);
  assert.equal(status.state, 'CANCELLED');
  assert.equal(status.isComplete, false);
});

test('placeOrder returns provider name and timestamp', async () => {
  const provider = new MockProvider({ name: 'Fake Vendor Co' });
  const result = await provider.placeOrder(ctx());

  assert.equal(result.provider, 'Fake Vendor Co');
  assert.equal(result.created_at, '2026-08-16T00:00:00.000Z');
});

test('parallel orders get unique ids and independent state', async () => {
  const provider = new MockProvider();

  const placed = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      provider.placeOrder(ctx({ payload: { address: `${i} Main St` } }))
    )
  );

  const ids = placed.map((p) => p.vendorOrderId);
  assert.equal(new Set(ids).size, 50, 'all vendor order ids must be unique');

  // Advance only the first order to completion; others must stay untouched.
  await provider.getStatus(ids[0]);
  await provider.getStatus(ids[0]);
  assert.equal((await provider.getStatus(ids[0])).state, 'COMPLETE');
  assert.equal((await provider.getStatus(ids[1])).state, 'IN_PROGRESS');
});
