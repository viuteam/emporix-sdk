import type {
  UserResponse,
  UserExtendedResponse,
  UserCreateRequest,
  UserUpdateRequest,
  UserScopesResponse,
  UserIdResponse,
  GroupsQueryDocument,
  GroupCreateRequest,
  GroupUpdateRequest,
  GroupIdResponse,
  AssignmentCreateRequest,
  AssignmentIdResponse,
  AccessControlQueryDocument,
  AccessControlUpsertRequest,
  AccessControlIdResponse,
  CustomScopeQueryDocument,
  CustomScopeUpsertRequest,
  CustomScopeIdResponse,
} from "../generated/iam";

/** A user as returned by IAM (list item / summary). */
export type IamUser = UserResponse;
/** A user with its group memberships (single-user GET). */
export type IamUserDetail = UserExtendedResponse;
export type IamUserCreate = UserCreateRequest;
export type IamUserUpdate = UserUpdateRequest;
export type IamUserScopes = UserScopesResponse;
export type IamUserCreated = UserIdResponse;

/** A user group. */
export type IamGroup = GroupsQueryDocument;
export type IamGroupCreate = GroupCreateRequest;
export type IamGroupUpdate = GroupUpdateRequest;
export type IamGroupCreated = GroupIdResponse;
/** Body to add/assign a user to a group. */
export type IamGroupMemberInput = AssignmentCreateRequest;
export type IamGroupMemberCreated = AssignmentIdResponse;

export type IamAccessControl = AccessControlQueryDocument;
export type IamAccessControlUpsert = AccessControlUpsertRequest;
export type IamAccessControlCreated = AccessControlIdResponse;

export type IamScope = CustomScopeQueryDocument;
export type IamScopeUpsert = CustomScopeUpsertRequest;
export type IamScopeCreated = CustomScopeIdResponse;
