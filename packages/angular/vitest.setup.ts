import "zone.js";
import "zone.js/testing";
import { beforeEach } from "vitest";
import { getTestBed, TestBed } from "@angular/core/testing";
// `@angular/platform-browser/testing` is the Angular 20+ path — verified
// working on 22.1.3. Before v20 this module was
// `@angular/platform-browser-dynamic/testing` with `BrowserDynamicTestingModule`
// and `platformBrowserDynamicTesting`; if the peer floor ever drops below 20,
// that is the import to switch back to.
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { fetch, Headers, Request, Response, FormData } from "undici";

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

// Karma's Angular setup resets the module between specs for you; Vitest does
// not, so a second `configureTestingModule` in the same file throws "test
// module has already been instantiated". Doing it here means no test file has
// to remember, and each test gets a fresh injector — which also isolates the
// per-storage `getCustomerSessionStore` WeakMap.
beforeEach(() => {
  TestBed.resetTestingModule();
});

// jsdom + MSW v2: pin network primitives to the single undici realm that
// `msw/node` patches, so AbortSignal/Request instance checks line up.
Object.assign(globalThis, { fetch, Headers, Request, Response, FormData });
