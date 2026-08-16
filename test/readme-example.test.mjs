import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BaseProvider,
  MockProvider,
  MortgageVendorOS,
  RestEmailFallback,
} from '../dist/index.js';

test('README quick-start example works end to end', async () => {
  const os = new MortgageVendorOS();

  // Use the mock so the example runs with zero keys; the real provider
  // would be `new ReggoraProvider(process.env.REGGORA_KEY)`.
  os.use('APPRAISAL', new MockProvider());
  os.use(
    'TITLE',
    new RestEmailFallback('orders@bobstitle.com', process.env.RESEND_KEY ?? 're_demo_key')
  );

  // 1. Place Order
  const order = await os.order('APPRAISAL', {
    address: '123 Main St',
    loan_amount: 500_000,
  });
  assert.ok(order.vendorOrderId);

  // 2. Check Status (poll until complete)
  let status = await os.status('APPRAISAL', order.vendorOrderId);
  let guard = 0;
  while (!status.isComplete && guard++ < 5) {
    status = await os.status('APPRAISAL', order.vendorOrderId);
  }
  assert.equal(status.isComplete, true);

  // 3. Handle underwriting stipulations / messages
  const sent = await os.sendMessage('APPRAISAL', order.vendorOrderId, {
    text: 'Appraiser needs gate code: 1234',
  });
  assert.equal(sent.status, 'SENT');

  const messages = await os.getMessages('APPRAISAL', order.vendorOrderId);
  assert.equal(messages.messages.length, 1);
  assert.equal(messages.messages[0].text, 'Appraiser needs gate code: 1234');

  // 4. Retrieve final XML / PDF
  if (status.isComplete) {
    const docs = await os.documents('APPRAISAL', order.vendorOrderId);
    assert.equal(docs.status, 'AVAILABLE');
    assert.ok(docs.downloadUrls.length >= 2);
  }
});

test('all lifecycle methods are exposed on the public API', () => {
  const os = new MortgageVendorOS();
  for (const method of ['use', 'order', 'status', 'documents', 'sendMessage', 'getMessages']) {
    assert.equal(typeof os[method], 'function', `${method} should be a function`);
  }
  assert.equal(typeof BaseProvider, 'function');
  assert.equal(typeof RestEmailFallback, 'function');
  assert.equal(typeof MockProvider, 'function');
});
