/**
 * Public types for the SEPA Export Service — stable names aliased over the
 * generated `sepa-export` types.
 */
import type { JobDetails, CreateJob, JobId } from "../generated/sepa-export";

/** A SEPA export job (read / list item). */
export type SepaJob = JobDetails;
/** Create-job body (`POST /jobs`). */
export type SepaJobInput = CreateJob;
/** `POST /jobs` response — the created job's id. */
export type SepaJobCreated = JobId;
