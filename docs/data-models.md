# Data Models

Standardized snake_case order payloads that map cleanly onto mortgage-industry
APIs (Reggora, Fannie/Freddie wire formats). Every payload extends
`BaseOrder`.

## `BaseOrder` — shared fields

```ts
{
  loan_number?: string;      // lender's internal loan number
  reference_id?: string;     // your own tracking id
  borrower?: Borrower;       // { name, phone?, email?, ssn_last4?, dob? }
  lender?: Party;            // { name, phone?, email? }
  notes?: string;
  extra?: Record<string, unknown>; // vendor-specific passthrough (forwarded verbatim)
}
```

## Service payloads

```ts
// APPRAISAL
AppraisalOrder: {
  address: string | PropertyAddress;  // street string or { street, unit?, city, state, zip }
  loan_amount?: number;
  property_type?: 'SINGLE_FAMILY' | 'CONDO' | 'TOWNHOUSE' | 'MULTI_FAMILY' | 'COMMERCIAL';
  appraisal_type?: 'FULL' | 'EXTERIOR_ONLY' | 'DRIVE_BY' | 'DESKTOP' | 'REVIEW';
}

// TITLE
TitleOrder: {
  property: PropertyAddress;
  title_products?: ('OWNERS_POLICY' | 'LENDERS_POLICY' | 'PRIOR_OWNERSHIP' | 'TAX_SEARCH' | 'LIEN_SEARCH')[];
}

// HOI
HoiOrder: {
  property: PropertyAddress;
  insurance_type?: 'HO3' | 'HO6' | 'HO4';
  coverage_amount?: number;
  loss_payee?: string;              // lender loss-payee endorsement requirement
}

// VOE
VoeOrder: {
  employer?: Party & { address?: string };
  employee?: Borrower;
  verification_type?: 'FULL' | 'PHONE' | 'PDF';
  years_employed?: number;
}

// VOA
VoaOrder: {
  account_holder: Party;
  bank_name?: string;
  account_type?: 'CHECKING' | 'SAVINGS' | 'MONEY_MARKET' | 'CD';
  account_last4?: string;
}

// LIEN
LienOrder: {
  property: PropertyAddress;
  search_states?: string[];
}
```

## `PropertyAddress`

```ts
{ street: string; unit?: string; city: string; state: string; zip: string }
```

## Lifecycle result types

| Result | Shape |
| --- | --- |
| `OrderResult` | `{ vendorOrderId, service_type, provider, status, created_at, raw? }` |
| `VendorStatus` | `{ vendorOrderId, isComplete, state, detail?, updated_at?, raw? }` |
| `VendorDocuments` | `{ vendorOrderId, status, downloadUrls, documents?, raw? }` |
| `MessageResult` | `{ messageId, vendorOrderId, status, created_at, raw? }` |
| `MessagesResult` | `{ status, messages, raw? }` |

All are typed and exported from the package root. See the
[API Reference](api-reference.md) for full field definitions.

## PII guidance

Borrower identity keeps PII minimal — `ssn_last4` only, never a full SSN. If a
vendor needs more, pass it through `extra` and keep it out of your own logs.
