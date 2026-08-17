# API Reference

Every public export, method signature, and type in MortgageVendorOS.

## `MortgageVendorOS` (orchestrator)

```ts
new MortgageVendorOS()
```

### `use(service, provider)`

Register a provider for one or more services.

```ts
use(service: ServiceType | ServiceType[], provider: BaseProvider): this
```

- Throws `TypeError` if `provider` doesn't extend `BaseProvider`.
- Throws `UnknownServiceError` for an unknown service name.
- Re-registering replaces the existing provider.

### `remove(service)`

```ts
remove(service: ServiceType): this
```

Unregister a provider for a service. Throws `UnknownServiceError` for unknown
services.

### `provider(service)`

```ts
provider(service: ServiceType): BaseProvider | undefined
```

The provider currently registered for a service.

### `registrations()`

```ts
registrations(): ReadonlyMap<ServiceType, BaseProvider>
```

All registrations as a **defensive copy** — mutating the returned map never
touches internal state.

### `order(service, payload)`

```ts
order<S extends ServiceType>(service: S, payload: OrderPayloadFor<S>): Promise<OrderResult>
```

Places an order. The payload is normalized into an `OrderContext` before
reaching the provider. Throws `TypeError` for non-object payloads.

**`OrderResult`**

```ts
{
  vendorOrderId: string;      // vendor-assigned id (or generated for email fallback)
  service_type: ServiceType;
  provider: string;           // provider.name
  status: 'PLACED' | 'SUBMITTED' | 'FAILED';
  created_at: string;         // ISO timestamp
  raw?: unknown;              // raw vendor response, when available
}
```

### `status(service, vendorOrderId)`

```ts
status(service: ServiceType, vendorOrderId: string): Promise<VendorStatus>
```

**`VendorStatus`**

```ts
{
  vendorOrderId: string;
  isComplete: boolean;              // true when state === 'COMPLETE'
  state: VendorState;               // see below
  detail?: string;                  // human-readable detail
  updated_at?: string;
  raw?: unknown;
}
```

**`VendorState`**

```
'PLACED' | 'IN_PROGRESS' | 'COMPLETE' | 'CANCELLED' | 'FAILED' | 'REQUIRES_WEBHOOK_UPDATE'
```

### `documents(service, vendorOrderId)`

```ts
documents(service: ServiceType, vendorOrderId: string): Promise<VendorDocuments>
```

**`VendorDocuments`**

```ts
{
  vendorOrderId: string;
  status: 'AVAILABLE' | 'PENDING' | 'REQUIRES_WEBHOOK_UPDATE';
  downloadUrls: string[];
  documents?: { name: string; type?: 'PDF' | 'XML' | 'IMAGE' | 'OTHER'; downloadUrl: string }[];
  raw?: unknown;
}
```

### `sendMessage(service, vendorOrderId, message)`

```ts
sendMessage(service: ServiceType, vendorOrderId: string, message: MessagePayload): Promise<MessageResult>
```

Throws `TypeError` unless `message.text` is a non-empty string.

**`MessagePayload`**

```ts
{
  text: string;
  subject?: string;
  attachments?: { name: string; url?: string; content_type?: string }[];
  author?: string;
}
```

**`MessageResult`**

```ts
{ messageId: string; vendorOrderId: string; status: 'SENT' | 'FAILED'; created_at: string; raw?: unknown }
```

### `getMessages(service, vendorOrderId)`

```ts
getMessages(service: ServiceType, vendorOrderId: string): Promise<MessagesResult>
```

Returns an **envelope**, not a bare array, so the `REQUIRES_WEBHOOK_UPDATE`
signal is consistent across every inbound method.

**`MessagesResult`**

```ts
{
  status: 'AVAILABLE' | 'REQUIRES_WEBHOOK_UPDATE';
  messages: {
    id: string;
    vendorOrderId: string;
    direction: 'INBOUND' | 'OUTBOUND';
    author?: string;
    text: string;
    created_at: string;
    raw?: unknown;
  }[];
  raw?: unknown;
}
```

## `SERVICE_TYPES`

```ts
const SERVICE_TYPES: readonly ServiceType[]; // ['APPRAISAL','TITLE','HOI','VOE','VOA','LIEN']
```

## `BaseProvider` (abstract)

The contract every plugin must satisfy. Subclass and implement all five:

```ts
abstract class BaseProvider {
  readonly name: string;
  constructor(name: string);

  abstract placeOrder(orderCtx: OrderContext<OrderPayload>): Promise<OrderResult>;
  abstract getStatus(vendorOrderId: string): Promise<VendorStatus>;
  abstract getDocuments(vendorOrderId: string): Promise<VendorDocuments>;
  abstract sendMessage(vendorOrderId: string, message: MessagePayload): Promise<MessageResult>;
  abstract getMessages(vendorOrderId: string): Promise<MessagesResult>;
}
```

`placeOrder` receives an `OrderContext` — `{ service_type, payload, meta: { requested_at } }` —
so every plugin sees a consistent envelope.

## Providers

### `MockProvider`

```ts
new MockProvider(options?: {
  name?: string;                       // default 'MockProvider'
  statusChecksToComplete?: number;     // default 2
})
```

Methods beyond the lifecycle:

- `simulateInboundMessage(vendorOrderId, text, author?)` — fake a vendor reply.
- `setState(vendorOrderId, state)` — force a lifecycle state.
- `hasOrder(vendorOrderId)` — check existence.

### `ReggoraProvider`

```ts
new ReggoraProvider(authToken: string, integrationKey: string, options?: {
  baseUrl?: string;    // default 'https://api.reggora.io/lender/'
  fetchImpl?: typeof fetch;
})
```

Reggora-specific order fields travel through `payload.extra` (see
[Providers](providers.md#reggoraprovider)).

### `RestEmailFallback`

```ts
new RestEmailFallback(toEmail: string, apiKey: string, options?: {
  emailProvider?: 'resend' | 'sendgrid';   // default 'resend'
  from?: string;                            // default 'MortgageVendorOS <onboarding@resend.dev>'
  subjectPrefix?: string;
  fetchImpl?: typeof fetch;
})
```

## Errors

All errors extend `MortgageVendorOSError` and expose a stable `.code`. See
[Errors](errors.md).
