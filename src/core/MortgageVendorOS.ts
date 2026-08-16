import { MissingProviderError, UnknownServiceError } from '../errors.js';
import type {
  MessagePayload,
  MessageResult,
  MessagesResult,
  OrderContext,
  OrderPayloadFor,
  OrderResult,
  ServiceType,
  VendorDocuments,
  VendorStatus,
} from '../types.js';
import { BaseProvider } from './BaseProvider.js';

/** All services the orchestrator knows about. */
export const SERVICE_TYPES: readonly ServiceType[] = [
  'APPRAISAL',
  'TITLE',
  'HOI',
  'VOE',
  'VOA',
  'LIEN',
];

function isServiceType(value: string): value is ServiceType {
  return (SERVICE_TYPES as readonly string[]).includes(value);
}

/**
 * MortgageVendorOS — the unified translation layer for mortgage settlement
 * vendors.
 *
 * Register providers with `.use()`, then drive the full lifecycle with
 * `.order()`, `.status()`, `.documents()`, `.sendMessage()`, and
 * `.getMessages()`. The orchestrator knows nothing about individual vendors;
 * it routes each call to the registered `BaseProvider` for that service.
 *
 * ```ts
 * const os = new MortgageVendorOS();
 * os.use('APPRAISAL', new ReggoraProvider(process.env.REGGORA_KEY));
 * os.use('TITLE', new RestEmailFallback('orders@bobstitle.com', process.env.RESEND_KEY));
 *
 * const order = await os.order('APPRAISAL', { address: '123 Main St' });
 * const status = await os.status('APPRAISAL', order.vendorOrderId);
 * ```
 */
export class MortgageVendorOS {
  private readonly providers = new Map<ServiceType, BaseProvider>();

  /**
   * Register a provider for one or more services. Re-registering a service
   * replaces its provider (useful for tests and failover).
   */
  use(service: ServiceType | ServiceType[], provider: BaseProvider): this {
    if (!(provider instanceof BaseProvider)) {
      throw new TypeError(
        'use() requires a provider that extends BaseProvider.'
      );
    }
    const services = Array.isArray(service) ? service : [service];
    for (const s of services) {
      this.assertValidService(s);
      this.providers.set(s, provider);
    }
    return this;
  }

  /** Unregister a provider for a service. */
  remove(service: ServiceType): this {
    this.assertValidService(service);
    this.providers.delete(service);
    return this;
  }

  /** The provider currently registered for a service (or undefined). */
  provider(service: ServiceType): BaseProvider | undefined {
    this.assertValidService(service);
    return this.providers.get(service);
  }

  /** All registered (service → provider) registrations (a defensive copy). */
  registrations(): ReadonlyMap<ServiceType, BaseProvider> {
    return new Map(this.providers);
  }

  /**
   * Place an order with the provider registered for `service`.
   * The payload is normalized into an `OrderContext` before reaching the
   * provider, so every plugin sees a consistent envelope.
   */
  async order<S extends ServiceType>(
    service: S,
    payload: OrderPayloadFor<S>
  ): Promise<OrderResult> {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw new TypeError('order() requires a payload object.');
    }
    const provider = this.requireProvider(service);
    const ctx: OrderContext<OrderPayloadFor<S>> = {
      service_type: service,
      payload,
      meta: { requested_at: new Date().toISOString() },
    };
    return provider.placeOrder(ctx);
  }

  /** Get the current lifecycle status for a vendor order. */
  async status(service: ServiceType, vendorOrderId: string): Promise<VendorStatus> {
    this.assertOrderId(vendorOrderId);
    return this.requireProvider(service).getStatus(vendorOrderId);
  }

  /** Get final settlement document download URLs for a vendor order. */
  async documents(
    service: ServiceType,
    vendorOrderId: string
  ): Promise<VendorDocuments> {
    this.assertOrderId(vendorOrderId);
    return this.requireProvider(service).getDocuments(vendorOrderId);
  }

  /** Send a message (stipulation, gate code, follow-up) about a vendor order. */
  async sendMessage(
    service: ServiceType,
    vendorOrderId: string,
    message: MessagePayload
  ): Promise<MessageResult> {
    this.assertOrderId(vendorOrderId);
    if (!message || typeof message.text !== 'string' || message.text.trim() === '') {
      throw new TypeError('sendMessage requires a payload with non-empty `text`.');
    }
    return this.requireProvider(service).sendMessage(vendorOrderId, message);
  }

  /** Get the full message thread for a vendor order. */
  async getMessages(
    service: ServiceType,
    vendorOrderId: string
  ): Promise<MessagesResult> {
    this.assertOrderId(vendorOrderId);
    return this.requireProvider(service).getMessages(vendorOrderId);
  }

  // ------------------------------------------------------------------ //

  private requireProvider(service: ServiceType): BaseProvider {
    this.assertValidService(service);
    const provider = this.providers.get(service);
    if (!provider) {
      throw new MissingProviderError(service);
    }
    return provider;
  }

  private assertValidService(service: string): asserts service is ServiceType {
    if (!isServiceType(service)) {
      throw new UnknownServiceError(service);
    }
  }

  private assertOrderId(vendorOrderId: string): void {
    if (typeof vendorOrderId !== 'string' || vendorOrderId.trim() === '') {
      throw new TypeError('vendorOrderId must be a non-empty string.');
    }
  }
}
