# Errors

All errors extend `MortgageVendorOSError` and carry a stable, machine-readable
`code`. Catch the base class and branch on `.code`.

| Error | `code` | Thrown when |
| --- | --- | --- |
| `MissingProviderError` | `MISSING_PROVIDER` | Calling a lifecycle method for a service with no registered provider |
| `UnknownServiceError` | `UNKNOWN_SERVICE` | Passing a service string that isn't one of the six |
| `OrderNotFoundError` | `ORDER_NOT_FOUND` | A provider can't find the given `vendorOrderId` |
| `ProviderError` | `PROVIDER_ERROR` | A provider's upstream request failed (HTTP, network, bad payload) |
| `WebhookRequiredError` | `REQUIRES_WEBHOOK_UPDATE` | An inbound method can only be satisfied via webhook push |

## Example

```js
import { MortgageVendorOSError } from 'mortgage-vendor-os';

try {
  await os.status('APPRAISAL', order.vendorOrderId);
} catch (err) {
  if (err instanceof MortgageVendorOSError) {
    console.error(err.code, err.message);
    // e.g. "ORDER_NOT_FOUND Vendor order ... was not found on provider ..."
  } else {
    throw err; // unexpected — rethrow
  }
}
```

## Runtime validation (`TypeError`)

The orchestrator also validates input at the boundary with plain `TypeError`s
(not part of the error hierarchy):

- `use()` — provider must extend `BaseProvider`.
- `order()` — payload must be a non-null, non-array object.
- `status()` / `documents()` / `getMessages()` — `vendorOrderId` must be a
  non-empty string.
- `sendMessage()` — `message.text` must be a non-empty string.

## Provider-specific

- **`ReggoraProvider`** throws `ProviderError` when `extra.loan` /
  `extra.products` are missing, when manual allocation lacks `extra.vendors`,
  or when Reggora returns a non-2xx / malformed response.
- **`RestEmailFallback`** throws `ProviderError` on email-provider HTTP
  failures and when no `fetch` implementation is available.
