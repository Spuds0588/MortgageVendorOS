/**
 * Standardized data models for MortgageVendorOS.
 *
 * These are the "settlement vertical" models: Title, Appraisal, HOI (Hazard /
 * Homeowner's Insurance), VOE (Verification of Employment), VOA (Verification
 * of Assets), and Liens. Field naming follows common mortgage-industry wire
 * conventions (snake_case) so payloads map cleanly onto vendor APIs like
 * Reggora's.
 */

/** The settlement verticals MortgageVendorOS coordinates. */
export type ServiceType =
  | 'APPRAISAL'
  | 'TITLE'
  | 'HOI'
  | 'VOE'
  | 'VOA'
  | 'LIEN';

/** A party on the loan (borrower, lender, employer, ...). */
export interface Party {
  name: string;
  phone?: string;
  email?: string;
}

/** A US property address. `address` string fields accept this or a string. */
export interface PropertyAddress {
  street: string;
  unit?: string;
  city: string;
  state: string;
  zip: string;
}

/** Borrower identity — keep PII minimal; SSN last-4 only. */
export interface Borrower extends Party {
  ssn_last4?: string;
  dob?: string;
}

/** A document attached to an order (used for messages + document retrieval). */
export interface Attachment {
  name: string;
  /** Public or pre-signed URL. May be absent for email-only providers. */
  url?: string;
  content_type?: string;
}

/** ------------------------------------------------------------------ */
/* Order payloads (what you pass to `os.order(service, payload)`)      */
/** ------------------------------------------------------------------ */

/** Fields shared by every order payload. */
export interface BaseOrder {
  /** Lender's internal loan number. */
  loan_number?: string;
  /** Your own tracking id for this order. */
  reference_id?: string;
  borrower?: Borrower;
  lender?: Party;
  notes?: string;
  /**
   * Vendor-specific passthrough. Keys not modeled here are forwarded
   * verbatim to the provider so nothing is lost in translation.
   */
  extra?: Record<string, unknown>;
}

export type PropertyType =
  | 'SINGLE_FAMILY'
  | 'CONDO'
  | 'TOWNHOUSE'
  | 'MULTI_FAMILY'
  | 'COMMERCIAL';

export type AppraisalType =
  | 'FULL'
  | 'EXTERIOR_ONLY'
  | 'DRIVE_BY'
  | 'DESKTOP'
  | 'REVIEW';

export interface AppraisalOrder extends BaseOrder {
  /** Subject property. Accepts a string street address or a full address. */
  address: string | PropertyAddress;
  loan_amount?: number;
  property_type?: PropertyType;
  appraisal_type?: AppraisalType;
}

export type TitleProduct =
  | 'OWNERS_POLICY'
  | 'LENDERS_POLICY'
  | 'PRIOR_OWNERSHIP'
  | 'TAX_SEARCH'
  | 'LIEN_SEARCH';

export interface TitleOrder extends BaseOrder {
  property: PropertyAddress;
  title_products?: TitleProduct[];
}

export type InsuranceType = 'HO3' | 'HO6' | 'HO4';

export interface HoiOrder extends BaseOrder {
  property: PropertyAddress;
  insurance_type?: InsuranceType;
  coverage_amount?: number;
  /** Lender's loss-payee endorsement requirement. */
  loss_payee?: string;
}

export type VoeType = 'FULL' | 'PHONE' | 'PDF';

export interface VoeOrder extends BaseOrder {
  employer?: Party & { address?: string };
  employee?: Borrower;
  verification_type?: VoeType;
  /** Years at employer, when known. */
  years_employed?: number;
}

export type AccountType = 'CHECKING' | 'SAVINGS' | 'MONEY_MARKET' | 'CD';

export interface VoaOrder extends BaseOrder {
  account_holder: Party;
  bank_name?: string;
  account_type?: AccountType;
  /** Last 4 of the account number, when known. */
  account_last4?: string;
}

export interface LienOrder extends BaseOrder {
  property: PropertyAddress;
  search_states?: string[];
}

/** Maps each service to its standardized order payload. */
export interface ServiceOrderMap {
  APPRAISAL: AppraisalOrder;
  TITLE: TitleOrder;
  HOI: HoiOrder;
  VOE: VoeOrder;
  VOA: VoaOrder;
  LIEN: LienOrder;
}

/** Payload type for a given service, e.g. `OrderPayloadFor<'APPRAISAL'>`. */
export type OrderPayloadFor<S extends ServiceType> = ServiceOrderMap[S];

/** The union of all order payloads. */
export type OrderPayload = ServiceOrderMap[ServiceType];

/** ------------------------------------------------------------------ */
/* Lifecycle results                                                    */
/** ------------------------------------------------------------------ */

/**
 * The context handed to `BaseProvider.placeOrder()`. Providers never see the
 * raw service string alone — they get a normalized envelope.
 */
export interface OrderContext<P extends OrderPayload = OrderPayload> {
  service_type: ServiceType;
  payload: P;
  meta: {
    requested_at: string;
  };
}

export type OrderStatus = 'PLACED' | 'SUBMITTED' | 'FAILED';

export interface OrderResult {
  /** The id assigned by the vendor (or generated, for email fallback). */
  vendorOrderId: string;
  service_type: ServiceType;
  /** `provider.name` of the provider that handled the order. */
  provider: string;
  status: OrderStatus;
  created_at: string;
  /** The raw vendor response, when available. */
  raw?: unknown;
}

/**
 * Vendor lifecycle states. `REQUIRES_WEBHOOK_UPDATE` is the library-wide
 * signal that a provider has no API and can only report progress via webhook
 * callbacks pushed to your system.
 */
export type VendorState =
  | 'PLACED'
  | 'IN_PROGRESS'
  | 'COMPLETE'
  | 'CANCELLED'
  | 'FAILED'
  | 'REQUIRES_WEBHOOK_UPDATE';

export interface VendorStatus {
  vendorOrderId: string;
  /** Convenience flag: true when `state === 'COMPLETE'`. */
  isComplete: boolean;
  state: VendorState;
  /** Human-readable detail (e.g. "Appraiser assigned"). */
  detail?: string;
  updated_at?: string;
  raw?: unknown;
}

export type DocumentsStatus =
  | 'AVAILABLE'
  | 'PENDING'
  | 'REQUIRES_WEBHOOK_UPDATE';

export interface DocumentItem {
  name: string;
  type?: 'PDF' | 'XML' | 'IMAGE' | 'OTHER';
  downloadUrl: string;
}

export interface VendorDocuments {
  vendorOrderId: string;
  status: DocumentsStatus;
  downloadUrls: string[];
  documents?: DocumentItem[];
  raw?: unknown;
}

/** Outbound message payload (stipulations, gate codes, follow-ups...). */
export interface MessagePayload {
  text: string;
  subject?: string;
  attachments?: Attachment[];
  /** Who the message appears to come from (free text). */
  author?: string;
}

export interface MessageResult {
  messageId: string;
  vendorOrderId: string;
  status: 'SENT' | 'FAILED';
  created_at: string;
  raw?: unknown;
}

export type MessagesStatus = 'AVAILABLE' | 'REQUIRES_WEBHOOK_UPDATE';

export interface VendorMessage {
  id: string;
  vendorOrderId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  /** Display name of the author, e.g. "Acme Appraisals". */
  author?: string;
  text: string;
  created_at: string;
  raw?: unknown;
}

export interface MessagesResult {
  status: MessagesStatus;
  messages: VendorMessage[];
  raw?: unknown;
}
