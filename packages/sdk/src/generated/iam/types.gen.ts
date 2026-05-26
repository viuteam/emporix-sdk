/**
 * Hand-written mirror of the minimal IAM Service group shape needed for
 * B2B foundation reads. The Emporix IAM API exposes groups keyed by
 * `b2b.legalEntityId`. Membership-mutation endpoints exist on the server
 * but their exact path/body shape is not in the current SDK input set —
 * `customer-groups.ts` ships read-only here; mutations follow in a small
 * follow-up plan once the API reference is confirmed.
 */

export interface IamGroupB2B {
  legalEntityId?: string;
}

export interface IamGroup {
  id: string;
  name?: Record<string, string>;
  role?: string;
  b2b?: IamGroupB2B;
}
