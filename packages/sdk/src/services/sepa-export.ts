import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { errorFromResponse } from "../core/errors";
import type { SepaJob, SepaJobInput, SepaJobCreated } from "./sepa-export-types";

export type { SepaJob, SepaJobInput, SepaJobCreated } from "./sepa-export-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix SEPA Export Service (`/sepa-export/{tenant}/…`): export jobs and file
 * retrieval. Server-side; defaults to the service token.
 */
export class SepaExportService {
  static readonly channel = "sepa-export" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/sepa-export/${this.ctx.tenant}`;
  }

  /** Retrieve a SEPA export file by id. Returns the raw file content (text). */
  async getFile(fileId: string, auth: AuthContext = SERVICE): Promise<string> {
    const path = `${this.base()}/files/${encodeURIComponent(fileId)}`;
    const res = await this.ctx.http.requestRaw({ method: "GET", path, auth });
    if (!res.ok) {
      const errBody = await res.text().catch(() => undefined);
      throw errorFromResponse(res.status, `GET ${path} → ${res.status}`, errBody);
    }
    return res.text();
  }

  /** List export jobs. */
  async listJobs(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<SepaJob[]> {
    return this.ctx.http.request<SepaJob[]>({
      method: "GET",
      path: `${this.base()}/jobs`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Create an export job. */
  async createJob(input: SepaJobInput, auth: AuthContext = SERVICE): Promise<SepaJobCreated> {
    return this.ctx.http.request<SepaJobCreated>({
      method: "POST",
      path: `${this.base()}/jobs`,
      auth,
      body: input,
    });
  }
}
