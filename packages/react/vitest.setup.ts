import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { fetch, Headers, Request, Response, FormData } from "undici";

// `globals: false` means RTL never auto-registers its `afterEach(cleanup)`, so
// hooks rendered in a test stay mounted to end-of-file and keep receiving async
// provider updates after their test ends — e.g. the company/site bootstrap
// `listMine()`/`sites` fetch that's still in flight settles late and calls
// setState on the live tree, a render that flushes into teardown and throws
// under coverage's slower timing (the use-shopping-lists.test.tsx flake).
// Unmounting after every test runs each bootstrap effect's cleanup, which flips
// its `cancelled` flag so the late settlement is a no-op.
afterEach(() => cleanup());

// jsdom + MSW v2: pin network primitives to the single undici realm that
// `msw/node` patches, so AbortSignal/Request instance checks line up.
Object.assign(globalThis, { fetch, Headers, Request, Response, FormData });
