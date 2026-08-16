/**
 * Base error for all MortgageVendorOS failures.
 * Every error carries a stable machine-readable `code` so callers can branch
 * on error type without relying on message strings.
 */
export class MortgageVendorOSError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'MortgageVendorOSError';
    this.code = code;
  }
}

/** Thrown when `os.use()` was never called for the requested service. */
export class MissingProviderError extends MortgageVendorOSError {
  constructor(service: string) {
    super(
      `No provider registered for service "${service}". Call os.use('${service}', provider) first.`,
      'MISSING_PROVIDER'
    );
    this.name = 'MissingProviderError';
  }
}

/** Thrown when an invalid service type is requested. */
export class UnknownServiceError extends MortgageVendorOSError {
  constructor(service: string) {
    super(
      `Unknown service "${service}". Valid services: APPRAISAL, TITLE, HOI, VOE, VOA, LIEN.`,
      'UNKNOWN_SERVICE'
    );
    this.name = 'UnknownServiceError';
  }
}

/** Thrown when a provider is asked for a vendor order id it does not know. */
export class OrderNotFoundError extends MortgageVendorOSError {
  constructor(vendorOrderId: string, provider: string) {
    super(
      `Vendor order "${vendorOrderId}" was not found on provider "${provider}".`,
      'ORDER_NOT_FOUND'
    );
    this.name = 'OrderNotFoundError';
  }
}

/** Thrown when a provider's underlying API/transport call fails. */
export class ProviderError extends MortgageVendorOSError {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
    this.cause = cause;
  }
}

/**
 * Thrown when a provider cannot answer a request because it has no API and
 * relies on webhook callbacks (e.g. RestEmailFallback). The library generally
 * returns `REQUIRES_WEBHOOK_UPDATE` payloads instead of throwing, but this
 * error is available for callers that prefer exceptions.
 */
export class WebhookRequiredError extends MortgageVendorOSError {
  constructor(operation: string) {
    super(
      `Provider cannot answer "${operation}" synchronously: it has no API and pushes updates via webhook.`,
      'REQUIRES_WEBHOOK_UPDATE'
    );
    this.name = 'WebhookRequiredError';
  }
}
