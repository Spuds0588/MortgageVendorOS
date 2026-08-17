const $ = (id) => document.getElementById(id);

let currentOrderId = null;
let currentService = 'APPRAISAL';

const out = (el, data) => {
  el.textContent = JSON.stringify(data, null, 2);
  el.hidden = false;
};

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

$('place').addEventListener('click', async () => {
  currentService = $('service').value;
  const payload =
    currentService === 'TITLE'
      ? {
          property: { street: $('address').value, city: 'Boston', state: 'MA', zip: '02135' },
          loan_amount: Number($('amount').value) || undefined,
        }
      : {
          address: $('address').value,
          loan_amount: Number($('amount').value) || undefined,
        };

  $('place').disabled = true;
  try {
    const order = await api('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: currentService, payload }),
    });
    currentOrderId = order.vendorOrderId;
    out($('order-out'), order);
    $('lifecycle-card').hidden = false;
    $('message-card').hidden = false;
    setPill('NEW', 'pending');
  } catch (err) {
    out($('order-out'), { error: err.message });
  } finally {
    $('place').disabled = false;
  }
});

function setPill(label, tone) {
  const pill = $('state-pill');
  pill.textContent = label;
  pill.className = 'status-pill ' + (tone === 'complete' ? 'complete' : 'pending');
}

$('poll').addEventListener('click', async () => {
  try {
    const status = await api(
      `/api/status?service=${currentService}&vendorOrderId=${currentOrderId}`
    );
    out($('status-out'), status);
    setPill(status.isComplete ? 'COMPLETE' : status.state, status.isComplete ? 'complete' : 'pending');
  } catch (err) {
    out($('status-out'), { error: err.message });
  }
});

$('docs').addEventListener('click', async () => {
  try {
    const docs = await api(
      `/api/documents?service=${currentService}&vendorOrderId=${currentOrderId}`
    );
    out($('docs-out'), docs);
  } catch (err) {
    out($('docs-out'), { error: err.message });
  }
});

$('send').addEventListener('click', async () => {
  const text = $('msg-text').value;
  if (!text) return;
  try {
    const sent = await api('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: currentService,
        vendorOrderId: currentOrderId,
        message: { text },
      }),
    });
    out($('thread-out'), sent);
    $('msg-text').value = '';
  } catch (err) {
    out($('thread-out'), { error: err.message });
  }
});

$('refresh-msg').addEventListener('click', async () => {
  try {
    const thread = await api(
      `/api/messages?service=${currentService}&vendorOrderId=${currentOrderId}`
    );
    out($('thread-out'), thread);
  } catch (err) {
    out($('thread-out'), { error: err.message });
  }
});
