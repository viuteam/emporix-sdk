import type {
  JobRequest as GenJobRequest,
  JobCreationResponse as GenJobCreated,
  JobStatusResponse as GenJobStatus,
} from "../generated/invoice";

/** Input for {@link InvoiceService.createJob} — order ids + job type. */
export type InvoiceJobDraft = GenJobRequest;
/** Result of creating an invoice job — `{ jobId? }`. */
export type InvoiceJobCreated = GenJobCreated;
/** Status of an invoice job + per-order results. */
export type InvoiceJob = GenJobStatus;
