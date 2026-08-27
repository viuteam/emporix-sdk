import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { fetch, Headers, Request, Response, FormData } from "undici";

afterEach(() => cleanup());

/**
 * jsdom ships its own `fetch` and `AbortSignal`, and MSW v2 intercepts undici's.
 * With both present the SDK builds a request whose signal comes from one realm
 * and hands it to a fetch from the other, which rejects it — the failure reads
 * `Expected signal ("AbortSignal {}") to be an instance of AbortSignal`, and
 * every request escapes the mock as an `EmporixNetworkError`.
 *
 * Installing undici's globals puts all of it in one realm.
 * `packages/react/vitest.setup.ts` does exactly this, for exactly this reason.
 */
Object.assign(globalThis, { fetch, Headers, Request, Response, FormData });
