import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  IamUser,
  IamUserDetail,
  IamUserCreate,
  IamUserUpdate,
  IamUserScopes,
  IamUserCreated,
  IamGroup,
  IamGroupCreate,
  IamGroupUpdate,
  IamGroupCreated,
  IamGroupMemberInput,
  IamGroupMemberCreated,
  IamAccessControl,
  IamAccessControlUpsert,
  IamAccessControlCreated,
  IamScope,
  IamScopeUpsert,
  IamScopeCreated,
} from "./iam-types";

export type * from "./iam-types";

/**
 * IAM admin CRUD: users, user-groups, access-controls, scopes. Every method
 * requires an explicit `auth` (admin/service token; `getMe*` take the caller's
 * customer token). The deprecated legacy-RBAC model (roles/permissions/
 * resources/templates) is intentionally not wrapped.
 */
export class IamService {
  static readonly channel = "iam" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/iam/${this.ctx.tenant}`;
  }

  readonly users = {
    list: async (auth: AuthContext, query?: Record<string, string | number>): Promise<IamUser[]> =>
      this.ctx.http.request<IamUser[]>({
        method: "GET",
        path: `${this.base()}/users`,
        auth,
        ...(query ? { query } : {}),
      }),
    create: async (input: IamUserCreate, auth: AuthContext): Promise<IamUserCreated> =>
      this.ctx.http.request<IamUserCreated>({
        method: "POST",
        path: `${this.base()}/users`,
        auth,
        body: input,
      }),
    get: async (userId: string, auth: AuthContext): Promise<IamUserDetail> =>
      this.ctx.http.request<IamUserDetail>({
        method: "GET",
        path: `${this.base()}/users/${userId}`,
        auth,
      }),
    getMe: async (auth: AuthContext): Promise<IamUserDetail> =>
      this.ctx.http.request<IamUserDetail>({
        method: "GET",
        path: `${this.base()}/users/me`,
        auth,
      }),
    update: async (userId: string, input: IamUserUpdate, auth: AuthContext): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "PUT",
        path: `${this.base()}/users/${userId}`,
        auth,
        body: input,
      });
    },
    delete: async (userId: string, auth: AuthContext): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `${this.base()}/users/${userId}`,
        auth,
      });
    },
    getGroups: async (userId: string, auth: AuthContext): Promise<IamGroup[]> =>
      this.ctx.http.request<IamGroup[]>({
        method: "GET",
        path: `${this.base()}/users/${userId}/groups`,
        auth,
      }),
    /**
     * Reads one of a user's groups (`GET /users/{userId}/groups/{groupId}`).
     * The collection read above returns the same shape per entry; this exists
     * because Emporix exposes the item separately and a caller holding both ids
     * should not have to page the collection to resolve one group.
     */
    getGroup: async (userId: string, groupId: string, auth: AuthContext): Promise<IamGroup> =>
      this.ctx.http.request<IamGroup>({
        method: "GET",
        path: `${this.base()}/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`,
        auth,
      }),
    getScopes: async (userId: string, auth: AuthContext): Promise<IamUserScopes> =>
      this.ctx.http.request<IamUserScopes>({
        method: "GET",
        path: `${this.base()}/users/${userId}/scopes`,
        auth,
      }),
    getMyScopes: async (auth: AuthContext): Promise<IamUserScopes> =>
      this.ctx.http.request<IamUserScopes>({
        method: "GET",
        path: `${this.base()}/users/me/scopes`,
        auth,
      }),
    getAccessControls: async (userId: string, auth: AuthContext): Promise<IamAccessControl[]> =>
      this.ctx.http.request<IamAccessControl[]>({
        method: "GET",
        path: `${this.base()}/users/${userId}/access-controls`,
        auth,
      }),
    getMyAccessControls: async (auth: AuthContext): Promise<IamAccessControl[]> =>
      this.ctx.http.request<IamAccessControl[]>({
        method: "GET",
        path: `${this.base()}/users/me/access-controls`,
        auth,
      }),
  };

  readonly groups = {
    list: async (auth: AuthContext, query?: Record<string, string | number>): Promise<IamGroup[]> =>
      this.ctx.http.request<IamGroup[]>({
        method: "GET",
        path: `${this.base()}/groups`,
        auth,
        ...(query ? { query } : {}),
      }),
    create: async (input: IamGroupCreate, auth: AuthContext): Promise<IamGroupCreated> =>
      this.ctx.http.request<IamGroupCreated>({
        method: "POST",
        path: `${this.base()}/groups`,
        auth,
        body: input,
      }),
    get: async (groupId: string, auth: AuthContext): Promise<IamGroup> =>
      this.ctx.http.request<IamGroup>({
        method: "GET",
        path: `${this.base()}/groups/${groupId}`,
        auth,
      }),
    update: async (groupId: string, input: IamGroupUpdate, auth: AuthContext): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "PUT",
        path: `${this.base()}/groups/${groupId}`,
        auth,
        body: input,
      });
    },
    delete: async (groupId: string, auth: AuthContext): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `${this.base()}/groups/${groupId}`,
        auth,
      });
    },
    listUsers: async (groupId: string, auth: AuthContext): Promise<IamUser[]> =>
      this.ctx.http.request<IamUser[]>({
        method: "GET",
        path: `${this.base()}/groups/${groupId}/users`,
        auth,
      }),
    addUser: async (
      groupId: string,
      input: IamGroupMemberInput,
      auth: AuthContext,
    ): Promise<IamGroupMemberCreated> =>
      this.ctx.http.request<IamGroupMemberCreated>({
        method: "POST",
        path: `${this.base()}/groups/${groupId}/users`,
        auth,
        body: input,
      }),
    updateUser: async (
      groupId: string,
      userType: string,
      userId: string,
      input: IamGroupMemberInput,
      auth: AuthContext,
    ): Promise<IamGroupMemberCreated> =>
      this.ctx.http.request<IamGroupMemberCreated>({
        method: "PUT",
        path: `${this.base()}/groups/${groupId}/users/${userType}/${userId}`,
        auth,
        body: input,
      }),
    removeAllUsers: async (groupId: string, auth: AuthContext): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `${this.base()}/groups/${groupId}/users`,
        auth,
      });
    },
    listAccessControls: async (groupId: string, auth: AuthContext): Promise<IamAccessControl[]> =>
      this.ctx.http.request<IamAccessControl[]>({
        method: "GET",
        path: `${this.base()}/groups/${groupId}/access-controls`,
        auth,
      }),
  };

  readonly accessControls = {
    list: async (auth: AuthContext): Promise<IamAccessControl[]> =>
      this.ctx.http.request<IamAccessControl[]>({
        method: "GET",
        path: `${this.base()}/access-controls`,
        auth,
      }),
    get: async (id: string, auth: AuthContext): Promise<IamAccessControl> =>
      this.ctx.http.request<IamAccessControl>({
        method: "GET",
        path: `${this.base()}/access-controls/${id}`,
        auth,
      }),
    upsert: async (
      id: string,
      input: IamAccessControlUpsert,
      auth: AuthContext,
    ): Promise<IamAccessControlCreated> =>
      this.ctx.http.request<IamAccessControlCreated>({
        method: "PUT",
        path: `${this.base()}/access-controls/${id}`,
        auth,
        body: input,
      }),
    delete: async (id: string, auth: AuthContext): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `${this.base()}/access-controls/${id}`,
        auth,
      });
    },
  };

  readonly scopes = {
    list: async (auth: AuthContext): Promise<IamScope[]> =>
      this.ctx.http.request<IamScope[]>({
        method: "GET",
        path: `${this.base()}/scopes`,
        auth,
      }),
    get: async (scopeId: string, auth: AuthContext): Promise<IamScope> =>
      this.ctx.http.request<IamScope>({
        method: "GET",
        path: `${this.base()}/scopes/${scopeId}`,
        auth,
      }),
    upsertCustom: async (
      scopeId: string,
      input: IamScopeUpsert,
      auth: AuthContext,
    ): Promise<IamScopeCreated> =>
      this.ctx.http.request<IamScopeCreated>({
        method: "PUT",
        path: `${this.base()}/scopes/${scopeId}`,
        auth,
        body: input,
      }),
    deleteCustom: async (scopeId: string, auth: AuthContext): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `${this.base()}/scopes/${scopeId}`,
        auth,
      });
    },
  };
}
