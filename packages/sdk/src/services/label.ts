import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Label, LabelList, LabelInput, LabelUpdate } from "./label-types";

export type { Label, LabelList, LabelInput, LabelUpdate } from "./label-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Label Service (`/label/labels`): CRUD over product labels (e.g.
 * "Sale", "New"). Server-side; defaults to the service token. The path carries
 * no `{tenant}` segment — the tenant comes from the token.
 */
export class LabelService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/label/labels`;
  }

  /** List all labels. */
  async listLabels(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<LabelList> {
    return this.ctx.http.request<LabelList>({
      method: "GET",
      path: this.base(),
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one label by id. */
  async getLabel(labelId: string, auth: AuthContext = SERVICE): Promise<Label> {
    return this.ctx.http.request<Label>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(labelId)}`,
      auth,
    });
  }

  /** Create a label. */
  async createLabel(input: LabelInput, auth: AuthContext = SERVICE): Promise<Label> {
    return this.ctx.http.request<Label>({
      method: "POST",
      path: this.base(),
      auth,
      body: input,
    });
  }

  /** Replace a label by id. */
  async updateLabel(labelId: string, input: LabelUpdate, auth: AuthContext = SERVICE): Promise<Label> {
    return this.ctx.http.request<Label>({
      method: "PUT",
      path: `${this.base()}/${encodeURIComponent(labelId)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a label by id. */
  async patchLabel(labelId: string, patch: LabelUpdate, auth: AuthContext = SERVICE): Promise<Label> {
    return this.ctx.http.request<Label>({
      method: "PATCH",
      path: `${this.base()}/${encodeURIComponent(labelId)}`,
      auth,
      body: patch,
    });
  }

  /** Delete a label by id. */
  async deleteLabel(labelId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(labelId)}`,
      auth,
    });
  }
}
