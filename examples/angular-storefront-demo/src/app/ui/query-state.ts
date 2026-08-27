import { Component, input } from "@angular/core";

/**
 * The three states a read can be in that are not «here is your data».
 *
 * `paused` is the one worth having a component for. TanStack's default
 * `networkMode: "online"` pauses a retry when it decides the app is offline, and
 * a cross-origin request that fails before CORS headers arrive — which is what a
 * wrong tenant or client id produces — looks exactly like that. The query then
 * sits in `status: "pending"`, `fetchStatus: "paused"` and never errors.
 *
 * Without this, a misconfigured demo shows a spinner forever and the reader has
 * no way to tell a slow tenant from a typo. That was not a hypothesis: it is what
 * this example did until the state was rendered.
 */
@Component({
  selector: "app-query-state",
  templateUrl: "./query-state.html",
})
export class QueryState {
  readonly fetchStatus = input.required<string>();
  readonly error = input<Error | null>(null);
  readonly label = input("Request failed.");
  readonly pendingLabel = input("Loading…");
}
