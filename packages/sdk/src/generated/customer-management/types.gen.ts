/**
 * Hand-written mirror of the Customer Management Service OpenAPI 0.0.1
 * schemas. The shapes below are taken directly from the documented API
 * (Legal Entities, Contact Assignments, Locations endpoints).
 *
 * **Not generated.** When the OpenAPI input file lands in the repo, this
 * file is replaced by codegen output. Keep the exported names stable so the
 * façade re-exports don't churn.
 */

export type LegalEntityType = "COMPANY" | "SUBSIDIARY";

export interface AccountLimit {
  currency?: string;
  value?: number;
}

export interface LegalInfo {
  legalName?: string;
  registrationDate?: string;
  taxRegistrationNumber?: string;
  registrationAgency?: string;
  countryOfRegistration?: string;
  registrationId?: string;
}

export interface CustomerGroupRef {
  id: string;
  name?: Record<string, string>;
  role?: string;
}

export interface ResourceId {
  id: string;
}

export interface Metadata {
  version?: number;
  createdAt?: string;
  modifiedAt?: string;
  mixins?: Record<string, unknown>;
}

export interface LegalEntity {
  id: string;
  name: string;
  type: LegalEntityType;
  parentId?: string;
  accountLimit?: AccountLimit;
  legalInfo?: LegalInfo;
  customerGroups?: CustomerGroupRef[];
  entitiesAddresses?: ResourceId[];
  approvalGroup?: ResourceId[];
  restrictions?: string[];
  metadata?: Metadata;
  mixins?: Record<string, unknown>;
}

export interface LegalEntityCreate {
  id?: string;
  name: string;
  type?: LegalEntityType;
  parentId?: string;
  accountLimit?: AccountLimit;
  legalInfo?: LegalInfo;
  customerGroups?: CustomerGroupRef[];
  entitiesAddresses?: ResourceId[];
  approvalGroup?: ResourceId[];
  restrictions?: string[];
  metadata?: { mixins?: Record<string, unknown> };
  mixins?: Record<string, unknown>;
}

export interface LegalEntityUpdate {
  name?: string;
  parentId?: string;
  accountLimit?: AccountLimit;
  legalInfo?: LegalInfo;
  customerGroups?: CustomerGroupRef[];
  entitiesAddresses?: ResourceId[];
  approvalGroup?: ResourceId[];
  restrictions?: string[];
  metadata?: { version: number; mixins?: Record<string, unknown> };
  mixins?: Record<string, unknown>;
}

export type ContactAssignmentType = "PRIMARY" | "BILLING" | "LOGISTICS" | "CONTACT";

export interface ContactAssignment {
  id: string;
  legalEntity?: LegalEntity | { id: string };
  customer?: { id: string; name?: string; surname?: string; email?: string; phone?: string };
  type?: ContactAssignmentType;
  primary?: boolean;
  metadata?: Metadata;
  mixins?: Record<string, unknown>;
}

export interface ContactAssignmentCreate {
  id?: string;
  legalEntity: { id: string };
  customer: { id: string };
  type?: ContactAssignmentType;
  primary?: boolean;
  metadata?: { mixins?: Record<string, unknown> };
  mixins?: Record<string, unknown>;
}

export interface ContactAssignmentUpdate {
  type?: ContactAssignmentType;
  primary?: boolean;
  metadata?: { version: number; mixins?: Record<string, unknown> };
  mixins?: Record<string, unknown>;
}

export type LocationType = "HEADQUARTER" | "WAREHOUSE" | "OFFICE";

export interface ContactDetails {
  emails?: string[];
  phones?: string[];
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  countryCode?: string;
  tags?: string[];
}

export interface Location {
  id: string;
  name: string;
  type: LocationType;
  contactDetails?: ContactDetails;
  metadata?: Metadata;
  mixins?: Record<string, unknown>;
}

export interface LocationCreate {
  id?: string;
  legalEntityId: string;
  name: string;
  type: LocationType;
  contactDetails?: ContactDetails;
  metadata?: { mixins?: Record<string, unknown> };
  mixins?: Record<string, unknown>;
}

export interface LocationUpdate {
  name?: string;
  type?: LocationType;
  contactDetails?: ContactDetails;
  metadata?: { version: number; mixins?: Record<string, unknown> };
  mixins?: Record<string, unknown>;
}
