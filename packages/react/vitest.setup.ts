import "@testing-library/jest-dom/vitest";
import { fetch, Headers, Request, Response, FormData } from "undici";

// jsdom + MSW v2: pin network primitives to the single undici realm that
// `msw/node` patches, so AbortSignal/Request instance checks line up.
Object.assign(globalThis, { fetch, Headers, Request, Response, FormData });
