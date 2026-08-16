import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BaseProvider,
  MissingProviderError,
  MockProvider,
  MortgageVendorOS,
  SERVICE_TYPES,
  UnknownServiceError,
} from '../dist/index.js';

test('SERVICE_TYPES covers all six settlement verticals', () => {
  assert.deepEqual(SERVICE_TYPES, [
    'APPRAISAL',
    'TITLE',
    'HOI',
    'VOE',
    'VOA',
    'LIEN',
  ]);
});

test('use() registers a provider and order() routes to it', async () => {
  const os = new MortgageVendorOS();
  const provider = new MockProvider({ name: 'Test Vendor' });
  os.use('APPRAISAL', provider);

  const order = await os.order('APPRAISAL', {
    address: '123 Main St',
    loan_amount: 500_000,
  });

  assert.match(order.vendorOrderId, /^[0-9a-f-]{36}$/);
  assert.equal(order.service_type, 'APPRAISAL');
  assert.equal(order.provider, 'Test Vendor');
  assert.equal(order.status, 'PLACED');
  assert.ok(provider.hasOrder(order.vendorOrderId));
});

test('use() accepts an array of services for one provider', async () => {
  const os = new MortgageVendorOS();
  const provider = new MockProvider();
  os.use(['TITLE', 'HOI'], provider);

  assert.equal(os.provider('TITLE'), provider);
  assert.equal(os.provider('HOI'), provider);
  assert.equal(os.provider('APPRAISAL'), undefined);
});

test('use() is chainable and re-registration replaces the provider', async () => {
  const os = new MortgageVendorOS();
  const first = new MockProvider({ name: 'First' });
  const second = new MockProvider({ name: 'Second' });

  os.use('TITLE', first).use('TITLE', second);

  assert.equal(os.provider('TITLE'), second);
  const order = await os.order('TITLE', { property: { street: '1 Elm St', city: 'Denver', state: 'CO', zip: '80202' } });
  assert.equal(order.provider, 'Second');
});

test('remove() unregisters a provider', () => {
  const os = new MortgageVendorOS();
  os.use('LIEN', new MockProvider());
  os.remove('LIEN');
  assert.equal(os.provider('LIEN'), undefined);
  assert.equal(os.registrations().size, 0);
});

test('calling order() for an unregistered service throws MissingProviderError', async () => {
  const os = new MortgageVendorOS();
  await assert.rejects(
    os.order('APPRAISAL', { address: '123 Main St' }),
    (err) => err instanceof MissingProviderError && err.code === 'MISSING_PROVIDER'
  );
});

test('status() for an unregistered service throws MissingProviderError', async () => {
  const os = new MortgageVendorOS();
  await assert.rejects(
    os.status('TITLE', 'order-1'),
    MissingProviderError
  );
});

test('unknown service names throw UnknownServiceError from every method', async () => {
  const os = new MortgageVendorOS();
  os.use('APPRAISAL', new MockProvider());

  await assert.rejects(
    os.order('MORTGAGE', { address: 'x' }),
    (err) => err instanceof UnknownServiceError && err.code === 'UNKNOWN_SERVICE'
  );
  await assert.rejects(os.status('BOGUS', '1'), UnknownServiceError);
  await assert.rejects(os.documents('BOGUS', '1'), UnknownServiceError);
  await assert.rejects(
    os.sendMessage('BOGUS', '1', { text: 'hi' }),
    UnknownServiceError
  );
  await assert.rejects(os.getMessages('BOGUS', '1'), UnknownServiceError);
  assert.throws(() => os.use('BOGUS', new MockProvider()), UnknownServiceError);
  assert.throws(() => os.provider('BOGUS'), UnknownServiceError);
});

test('empty vendorOrderId is rejected with TypeError', async () => {
  const os = new MortgageVendorOS();
  os.use('APPRAISAL', new MockProvider());

  await assert.rejects(os.status('APPRAISAL', ''), TypeError);
  await assert.rejects(os.documents('APPRAISAL', '  '), TypeError);
  await assert.rejects(
    os.sendMessage('APPRAISAL', '', { text: 'hi' }),
    TypeError
  );
  await assert.rejects(os.getMessages('APPRAISAL', ''), TypeError);
});

test('sendMessage requires non-empty text', async () => {
  const os = new MortgageVendorOS();
  os.use('APPRAISAL', new MockProvider());
  const order = await os.order('APPRAISAL', { address: '1 Main St' });

  await assert.rejects(
    os.sendMessage('APPRAISAL', order.vendorOrderId, { text: '   ' }),
    TypeError
  );
  await assert.rejects(
    os.sendMessage('APPRAISAL', order.vendorOrderId, {}),
    TypeError
  );
});

test('a custom BaseProvider subclass satisfies the full lifecycle', async () => {
  class EchoProvider extends BaseProvider {
    constructor() {
      super('Echo');
    }
    async placeOrder(ctx) {
      return {
        vendorOrderId: `echo-${ctx.payload.reference_id ?? 'x'}`,
        service_type: ctx.service_type,
        provider: this.name,
        status: 'PLACED',
        created_at: ctx.meta.requested_at,
      };
    }
    async getStatus(id) {
      return { vendorOrderId: id, isComplete: true, state: 'COMPLETE' };
    }
    async getDocuments(id) {
      return { vendorOrderId: id, status: 'AVAILABLE', downloadUrls: [`https://x/${id}.pdf`] };
    }
    async sendMessage(id, msg) {
      return { messageId: 'm1', vendorOrderId: id, status: 'SENT', created_at: new Date().toISOString() };
    }
    async getMessages(id) {
      return { status: 'AVAILABLE', messages: [] };
    }
  }

  const os = new MortgageVendorOS();
  os.use('VOE', new EchoProvider());

  const order = await os.order('VOE', { reference_id: 'loan-42' });
  assert.equal(order.vendorOrderId, 'echo-loan-42');
  const status = await os.status('VOE', order.vendorOrderId);
  assert.equal(status.isComplete, true);
  const docs = await os.documents('VOE', order.vendorOrderId);
  assert.equal(docs.downloadUrls.length, 1);
  const sent = await os.sendMessage('VOE', order.vendorOrderId, { text: 'hi' });
  assert.equal(sent.status, 'SENT');
  const thread = await os.getMessages('VOE', order.vendorOrderId);
  assert.equal(thread.messages.length, 0);
});

test('order() passes a normalized OrderContext to the provider', async () => {
  let seenContext;
  class CaptureProvider extends BaseProvider {
    constructor() {
      super('Capture');
    }
    async placeOrder(ctx) {
      seenContext = ctx;
      return { vendorOrderId: 'v1', service_type: ctx.service_type, provider: this.name, status: 'PLACED', created_at: ctx.meta.requested_at };
    }
    async getStatus() {
      return { vendorOrderId: 'v1', isComplete: false, state: 'PLACED' };
    }
    async getDocuments() {
      return { vendorOrderId: 'v1', status: 'PENDING', downloadUrls: [] };
    }
    async sendMessage() {
      return { messageId: 'm', vendorOrderId: 'v1', status: 'SENT', created_at: '' };
    }
    async getMessages() {
      return { status: 'AVAILABLE', messages: [] };
    }
  }

  const os = new MortgageVendorOS();
  os.use('APPRAISAL', new CaptureProvider());
  await os.order('APPRAISAL', { address: '9 Oak St' });

  assert.equal(seenContext.service_type, 'APPRAISAL');
  assert.deepEqual(seenContext.payload, { address: '9 Oak St' });
  assert.ok(seenContext.meta.requested_at);
  assert.ok(!Number.isNaN(Date.parse(seenContext.meta.requested_at)));
});
