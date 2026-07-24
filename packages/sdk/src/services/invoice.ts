import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { InvoiceJobDraft, InvoiceJobCreated, InvoiceJob } from "./invoice-types";

export type { InvoiceJobDraft, InvoiceJobCreated, InvoiceJob } from "./invoice-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Invoice Service (`/invoice/{tenant}/…`): create invoice-generation jobs and
 * poll their status. Backend-only — default auth: service.
 */
export class InvoiceService {
  static readonly channel = "invoice" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/invoice/${this.ctx.tenant}/jobs/invoices`;
  }

  /** Create an invoice-generation job (`POST …/jobs/invoices`, 201). */
  async createJob(draft: InvoiceJobDraft, auth: AuthContext = SERVICE): Promise<InvoiceJobCreated> {
    return this.ctx.http.request<InvoiceJobCreated>({
      method: "POST",
      path: this.base(),
      auth,
      body: draft,
    });
  }

  /** Retrieve a job and its per-order results (`GET …/jobs/invoices/{jobId}`). */
  async getJob(jobId: string, auth: AuthContext = SERVICE): Promise<InvoiceJob> {
    return this.ctx.http.request<InvoiceJob>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(jobId)}`,
      auth,
    });
  }
}
