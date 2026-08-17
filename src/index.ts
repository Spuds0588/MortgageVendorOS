/**
 * MortgageVendorOS — a free, open-source, edge-compatible library that unifies
 * ordering, status tracking, messaging, and document retrieval across mortgage
 * settlement vendors.
 *
 * ```ts
 * import { MortgageVendorOS, MockProvider } from 'mortgage-vendor-os';
 *
 * const os = new MortgageVendorOS();
 * os.use('APPRAISAL', new MockProvider());
 *
 * const order = await os.order('APPRAISAL', { address: '123 Main St' });
 * const status = await os.status('APPRAISAL', order.vendorOrderId);
 * ```
 *
 * @packageDocumentation
 */

export { MortgageVendorOS, SERVICE_TYPES } from './core/MortgageVendorOS.js';
export { BaseProvider } from './core/BaseProvider.js';

export {
  MortgageVendorOSError,
  MissingProviderError,
  UnknownServiceError,
  OrderNotFoundError,
  ProviderError,
  WebhookRequiredError,
} from './errors.js';

export { RestEmailFallback } from './providers/RestEmailFallback.js';
export type { EmailProvider, RestEmailFallbackOptions } from './providers/RestEmailFallback.js';

export { ReggoraProvider } from './providers/ReggoraProvider.js';
export type {
  ReggoraProviderOptions,
  ReggoraPriority,
  ReggoraAllocationType,
  ReggoraOrderRequestMethod,
  ReggoraOrderExtra,
} from './providers/ReggoraProvider.js';

export { MockProvider } from './providers/MockProvider.js';
export type { MockProviderOptions } from './providers/MockProvider.js';

export type {
  // Enums / unions
  ServiceType,
  VendorState,
  OrderStatus,
  DocumentsStatus,
  MessagesStatus,
  PropertyType,
  AppraisalType,
  TitleProduct,
  InsuranceType,
  VoeType,
  AccountType,
  // Shared models
  Party,
  PropertyAddress,
  Borrower,
  Attachment,
  // Order payloads
  BaseOrder,
  AppraisalOrder,
  TitleOrder,
  HoiOrder,
  VoeOrder,
  VoaOrder,
  LienOrder,
  ServiceOrderMap,
  OrderPayloadFor,
  OrderPayload,
  // Lifecycle results
  OrderContext,
  OrderResult,
  VendorStatus,
  VendorDocuments,
  DocumentItem,
  MessagePayload,
  MessageResult,
  VendorMessage,
  MessagesResult,
} from './types.js';
