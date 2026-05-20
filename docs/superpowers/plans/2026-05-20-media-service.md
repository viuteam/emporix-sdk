# Media Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `MediaService` (BLOB upload + LINK + product attachment via `refIds`), extend `HttpClient` with `FormData` support, remove the broken `ProductService.media`, and add a thin `useProductMedia` React hook.

**Architecture:** Vendor the Emporix media OpenAPI spec, generate types into `src/generated/media/`. Extend `HttpClient` so `FormData` bodies pass through fetch verbatim (no JSON-stringify, no `Content-Type` injection). Build a hand-written `MediaService` facade with discriminated `create({ kind: "blob" | "link" })` plus convenience helpers (`uploadFile`, `link`, `attachToProduct`, `detachFromProduct`, `listForProduct`). Delete the only consumer (a single facade-coverage assertion) of the broken `ProductService.media` and remove that block. React hook reads `productMedia` from the existing product query — no Media-Service browser calls.

**Tech Stack:** TypeScript 5.x strict, `@hey-api/openapi-ts` (types only), tsup, vitest + msw, @testing-library/react + jsdom, Changesets, commitlint.

**Spec:** `docs/superpowers/specs/2026-05-20-media-service-design.md`.

**Branch:** `feat/media-service` (already created from `main`).

---

### Task 1: Vendor & generate the Media spec

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create (generated): `packages/sdk/specs/media.yml`, `packages/sdk/src/generated/media/`
- Create: `docs/superpowers/plans/plan-media-type-bindings.md`

- [ ] **Step 1: Add the media spec source**

In `packages/sdk/scripts/fetch-specs.ts`, add a `media` entry to the `SPECS` map (after the `price` line):

```ts
  price: `${BASE}/prices-and-taxes/price-service/api-reference/api.yml`,
  media: `${BASE}/media/media/api-reference/api.yml`,
```

- [ ] **Step 2: Fetch and generate**

Run:

```bash
pnpm --filter @viu/emporix-sdk fetch:specs
pnpm --filter @viu/emporix-sdk generate
```

Expected: lines `fetched media (<bytes>)` and `generated media`. New files
under `packages/sdk/specs/media.yml`, `packages/sdk/src/generated/media/index.ts`,
`packages/sdk/src/generated/media/types.gen.ts`, each prefixed with the
`// AUTO-GENERATED — do not edit` banner.

- [ ] **Step 3: Identify the canonical generated symbols**

Run:

```bash
cd packages/sdk/src/generated/media
grep -oE "^export type [A-Za-z0-9_]+" types.gen.ts | sed 's/export type //' \
  | grep -iE 'asset|refid|create|link|blob|update|list' | head -40
```

Read the output and pick:
- **Create-BLOB request body** (`AssetCreateBlob` or similar)
- **Create-LINK request body** (`AssetCreateLink` or similar)
- **Asset retrieval** types (`GetAssetBlob` / `GetAssetLink`, or a union `Asset`)
- **Update DTO** (PUT body)
- **refId entry** type
- **List response** (`Assets` / `Asset[]` / paginated)

- [ ] **Step 4: Record the bindings**

Create `docs/superpowers/plans/plan-media-type-bindings.md`:

```markdown
# Plan — Media Service Type Bindings

Verified against `packages/sdk/src/generated/media/types.gen.ts`.

| Public alias | Generated symbol |
|---|---|
| `AssetCreateBlobInput` | `<BLOB request type>` |
| `AssetCreateLinkInput` | `<LINK request type>` |
| `Asset` | `<read response type or union>` |
| `AssetUpdateInput` | `<PUT body type>` |
| `AssetRefId` | `<refIds[] item type>` |
| `AssetListResponse` | `<list response type>` |

Replace `<...>` with the exact names from Step 3.
```

Substitute the placeholders inline with the names from Step 3 — this file is the canonical reference every later task uses.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/media.yml \
  packages/sdk/src/generated/media docs/superpowers/plans/plan-media-type-bindings.md
git commit -m "chore(media): vendor + generate the Emporix media spec"
```

---

### Task 2: `HttpClient` — `FormData` body branch

**Files:**
- Modify: `packages/sdk/src/core/http.ts:72-81`
- Test: `packages/sdk/tests/http-basic.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/http-basic.test.ts` (the file already sets up
an msw `server` with the Bearer-token plumbing — reuse it; if its harness
differs, copy the `setupServer`/`auth: { kind: "anonymous" }` shape from
`tests/http-headers.test.ts`):

```ts
it("FormData body passes through fetch verbatim (no JSON stringify, no Content-Type)", async () => {
  let seenCT: string | null = null;
  let receivedFile: File | null = null;
  let receivedBody: string | null = null;
  server.use(
    http.post("https://api.emporix.io/echo/multipart", async ({ request }) => {
      seenCT = request.headers.get("content-type");
      const fd = await request.formData();
      const f = fd.get("file");
      if (f instanceof File) receivedFile = f;
      const b = fd.get("body");
      if (typeof b === "string") receivedBody = b;
      return HttpResponse.json({ ok: true });
    }),
  );
  const fd = new FormData();
  fd.set("file", new File(["hello"], "hello.txt", { type: "text/plain" }));
  fd.set("body", JSON.stringify({ k: 1 }));
  await httpClient().request({
    method: "POST",
    path: "/echo/multipart",
    auth: { kind: "anonymous" },
    body: fd,
  });
  // fetch sets `multipart/form-data; boundary=...` itself when the SDK does NOT.
  expect(seenCT).toMatch(/^multipart\/form-data; boundary=/);
  expect(receivedBody).toBe('{"k":1}');
  expect(receivedFile?.name).toBe("hello.txt");
});
```

If the file does not already export an `httpClient()` factory like other
test files do, copy the standard one from `tests/http-headers.test.ts`
(uses `DefaultTokenProvider` + anonymous mock — same pattern).

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- http-basic`
Expected: FAIL — `Content-Type` is `application/json` (the SDK still
forces it) AND/OR the request body parses as the string `"[object FormData]"`
because `JSON.stringify(new FormData())` produces `"{}"`-ish noise.

- [ ] **Step 3: Branch on `FormData` in `HttpClient`**

In `packages/sdk/src/core/http.ts`, replace the existing init/body block
(currently lines 72-81 — the lines that build `init` and assign
`init.body = JSON.stringify(o.body)`) with:

```ts
      const isFormData =
        typeof FormData !== "undefined" && o.body instanceof FormData;
      const init: RequestInit = {
        method: o.method,
        headers: {
          ...(o.headers ?? {}),
          Authorization: `Bearer ${token}`,
          // JSON bodies: set Content-Type. FormData bodies: let `fetch`
          // emit `multipart/form-data; boundary=...` itself.
          ...(o.body !== undefined && !isFormData
            ? { "Content-Type": "application/json" }
            : {}),
        },
        signal: controller.signal,
      };
      if (o.body !== undefined) {
        init.body = isFormData ? (o.body as FormData) : JSON.stringify(o.body);
      }
```

Also widen the `RequestOptions.body` type in the same file so callers can
pass `FormData` without a cast: locate the `body?: unknown;` line on the
`RequestOptions` interface and leave it as `unknown` — `unknown` already
accepts `FormData`, no type change required.

- [ ] **Step 4: Run tests + sdk typecheck**

Run: `pnpm --filter @viu/emporix-sdk test -- http && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/http.ts packages/sdk/tests/http-basic.test.ts
git commit -m "feat(http): pass FormData bodies through fetch unchanged"
```

---

### Task 3: `MediaService` — CRUD + `create` (BLOB & LINK) + client wiring

**Files:**
- Create: `packages/sdk/src/services/media.ts`
- Create: `packages/sdk/src/media.ts` (subpath barrel)
- Modify: `packages/sdk/src/client.ts`, `packages/sdk/src/core/logger.ts`, `packages/sdk/src/index.ts`, `packages/sdk/package.json`, `packages/sdk/tsup.config.ts`, `commitlint.config.js`
- Test: `packages/sdk/tests/services/media.test.ts`

Throughout, substitute generated names per `plan-media-type-bindings.md`.

- [ ] **Step 1: Write the failing tests**

Create `packages/sdk/tests/services/media.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { MediaService } from "../../src/services/media";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "media" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new MediaService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

describe("MediaService.create", () => {
  it("BLOB: posts multipart/form-data with file + body JSON parts and a service token", async () => {
    let seen: { auth: string | null; ct: string | null; file: File | null; body: string | null } | null = null;
    server.use(
      http.post("https://api.emporix.io/media/acme/assets", async ({ request }) => {
        seen = {
          auth: request.headers.get("authorization"),
          ct: request.headers.get("content-type"),
          file: null,
          body: null,
        };
        const fd = await request.formData();
        const f = fd.get("file");
        if (f instanceof File) seen.file = f;
        const b = fd.get("body");
        if (typeof b === "string") seen.body = b;
        return HttpResponse.json({ id: "asset-1" }, { status: 201 });
      }),
    );
    const result = await svc().create({
      kind: "blob",
      file: new File(["xyz"], "image.jpg", { type: "image/jpeg" }),
      body: {
        type: "BLOB",
        access: "PUBLIC",
        refIds: [{ type: "PRODUCT", id: "p1" }],
        details: { filename: "image.jpg", mimeType: "image/jpeg" },
      },
    });
    expect(result.id).toBe("asset-1");
    expect(seen?.auth).toBe("Bearer svc-tok");
    expect(seen?.ct).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen?.file?.name).toBe("image.jpg");
    const parsed = JSON.parse(seen!.body!);
    expect(parsed).toMatchObject({
      type: "BLOB",
      access: "PUBLIC",
      refIds: [{ type: "PRODUCT", id: "p1" }],
      details: { filename: "image.jpg", mimeType: "image/jpeg" },
    });
  });

  it("LINK: posts application/json with the AssetCreateLink body", async () => {
    let seen: { ct: string | null; body: unknown } | null = null;
    server.use(
      http.post("https://api.emporix.io/media/acme/assets", async ({ request }) => {
        seen = { ct: request.headers.get("content-type"), body: await request.json() };
        return HttpResponse.json({ id: "asset-2" }, { status: 201 });
      }),
    );
    const result = await svc().create({
      kind: "link",
      body: {
        type: "LINK",
        access: "PUBLIC",
        url: "https://cdn.example/i.jpg",
        refIds: [{ type: "PRODUCT", id: "p1" }],
      },
    });
    expect(result.id).toBe("asset-2");
    expect(seen?.ct).toBe("application/json");
    expect(seen?.body).toMatchObject({
      type: "LINK",
      access: "PUBLIC",
      url: "https://cdn.example/i.jpg",
    });
  });
});

describe("MediaService CRUD", () => {
  it("get/list/update/remove use the assets resource", async () => {
    server.use(
      http.get("https://api.emporix.io/media/acme/assets/asset-1", () =>
        HttpResponse.json({ id: "asset-1", type: "BLOB", access: "PUBLIC" }),
      ),
      http.get("https://api.emporix.io/media/acme/assets", () =>
        HttpResponse.json([{ id: "asset-1" }, { id: "asset-2" }]),
      ),
      http.put("https://api.emporix.io/media/acme/assets/asset-1", async ({ request }) => {
        const body = (await request.json()) as { access?: string };
        return HttpResponse.json({ id: "asset-1", access: body.access ?? "PUBLIC" });
      }),
      http.delete(
        "https://api.emporix.io/media/acme/assets/asset-1",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const s = svc();
    expect((await s.get("asset-1")).id).toBe("asset-1");
    expect(await s.list()).toHaveLength(2);
    expect((await s.update("asset-1", { access: "PRIVATE" })).access).toBe("PRIVATE");
    await expect(s.remove("asset-1")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- media`
Expected: FAIL — `MediaService` does not exist.

- [ ] **Step 3: Implement `MediaService`**

Create `packages/sdk/src/services/media.ts` (replace `AssetCreateBlobInput`,
`AssetCreateLinkInput`, `Asset`, `AssetUpdateInput`, `AssetRefId` with the
names recorded in `plan-media-type-bindings.md`):

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  AssetCreateBlobInput as GeneratedAssetCreateBlob,
  AssetCreateLinkInput as GeneratedAssetCreateLink,
  Asset as GeneratedAsset,
  AssetUpdateInput as GeneratedAssetUpdate,
  AssetRefId as GeneratedAssetRefId,
} from "../generated/media";

/** Generated media types (caller sends the exact wire shape). */
export type AssetCreateBlobInput = GeneratedAssetCreateBlob;
export type AssetCreateLinkInput = GeneratedAssetCreateLink;
export type AssetUpdateInput = GeneratedAssetUpdate;
export type Asset = GeneratedAsset;
export type AssetRefId = GeneratedAssetRefId;

const SERVICE: AuthContext = { kind: "service" };

function isProductRef(r: AssetRefId | undefined, productId: string): boolean {
  return !!r && (r as { type?: string; id?: string }).type === "PRODUCT"
    && (r as { id?: string }).id === productId;
}

/**
 * Media assets (BLOB/LINK). All endpoints require a backend-only scope
 * (`media.asset_manage` / `media.asset_read`) — default auth: service.
 */
export class MediaService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/media/${this.ctx.tenant}/assets`;
  }

  /** Create an asset. BLOB uploads via multipart; LINK via JSON. */
  async create(
    input:
      | { kind: "blob"; file: Blob; body: AssetCreateBlobInput }
      | { kind: "link"; body: AssetCreateLinkInput },
    auth: AuthContext = SERVICE,
  ): Promise<{ id: string }> {
    if (input.kind === "blob") {
      const fd = new FormData();
      fd.set("file", input.file);
      fd.set("body", JSON.stringify(input.body));
      return this.ctx.http.request<{ id: string }>({
        method: "POST",
        path: this.base(),
        auth,
        body: fd,
      });
    }
    return this.ctx.http.request<{ id: string }>({
      method: "POST",
      path: this.base(),
      auth,
      body: input.body,
    });
  }

  /** List assets (query is passed through to Emporix). */
  async list(
    query?: Record<string, string | number | undefined>,
    auth: AuthContext = SERVICE,
  ): Promise<Asset[]> {
    return this.ctx.http.request<Asset[]>({
      method: "GET",
      path: this.base(),
      auth,
      ...(query ? { query } : {}),
    });
  }

  /** Fetch an asset by id. */
  async get(assetId: string, auth: AuthContext = SERVICE): Promise<Asset> {
    return this.ctx.http.request<Asset>({
      method: "GET",
      path: `${this.base()}/${assetId}`,
      auth,
    });
  }

  /** Update an asset (e.g. swap `refIds` or `access`). */
  async update(
    assetId: string,
    patch: AssetUpdateInput,
    auth: AuthContext = SERVICE,
  ): Promise<Asset> {
    return this.ctx.http.request<Asset>({
      method: "PUT",
      path: `${this.base()}/${assetId}`,
      auth,
      body: patch,
    });
  }

  /** Remove an asset. */
  async remove(assetId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${assetId}`,
      auth,
    });
  }
}
```

- [ ] **Step 4: Wire it into the client**

In `packages/sdk/src/client.ts`:

- Add the import after the `PriceService` import:
  ```ts
  import { PriceService } from "./services/price";
  import { MediaService } from "./services/media";
  ```
- Add the field after `readonly prices: PriceService;`:
  ```ts
  readonly prices: PriceService;
  readonly media: MediaService;
  ```
- Add the construction after `this.prices = new PriceService(mk("price"));`:
  ```ts
  this.prices = new PriceService(mk("price"));
  this.media = new MediaService(mk("media"));
  ```

In `packages/sdk/src/core/logger.ts`, add `"media"` to the `ServiceName`
union (currently lists `customer | product | category | cart | checkout |
payment | price | http | auth` — append `| "media"` keeping the same
formatting).

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm --filter @viu/emporix-sdk test -- media && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Public exports & subpath**

Create `packages/sdk/src/media.ts`:

```ts
export * from "./services/media";
```

In `packages/sdk/src/index.ts`, after the price exports add:

```ts
export { MediaService } from "./services/media";
export type {
  Asset,
  AssetCreateBlobInput,
  AssetCreateLinkInput,
  AssetUpdateInput,
  AssetRefId,
} from "./services/media";
```

In `packages/sdk/package.json` `exports`, after the `"./price"` line add:

```json
    "./price": { "types": "./dist/price.d.ts", "import": "./dist/price.js", "require": "./dist/price.cjs" },
    "./media": { "types": "./dist/media.d.ts", "import": "./dist/media.js", "require": "./dist/media.cjs" }
```

(Add the trailing comma to the previous `"./price"` line; keep
`{ types, import, require }` order — consistent with the rest.)

In `packages/sdk/tsup.config.ts`, add `"src/media.ts",` to the `entry`
array (after `"src/price.ts",`).

In `commitlint.config.js`, add `"media"` to the `scope-enum` array (after
`"price"`).

- [ ] **Step 7: Verify build emits the subpath**

```bash
pnpm --filter @viu/emporix-sdk build
ls packages/sdk/dist/media.js packages/sdk/dist/media.cjs packages/sdk/dist/media.d.ts
```

Expected: all three exist; no "types condition never used" warning.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/services/media.ts packages/sdk/src/media.ts \
  packages/sdk/src/client.ts packages/sdk/src/core/logger.ts \
  packages/sdk/src/index.ts packages/sdk/package.json \
  packages/sdk/tsup.config.ts commitlint.config.js \
  packages/sdk/tests/services/media.test.ts
git commit -m "feat(media): add MediaService with BLOB + LINK create and CRUD"
```

---

### Task 4: Convenience helpers (`uploadFile`, `link`, `attachToProduct`, `detachFromProduct`, `listForProduct`)

**Files:**
- Modify: `packages/sdk/src/services/media.ts`
- Test: `packages/sdk/tests/services/media.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside `packages/sdk/tests/services/media.test.ts`:

```ts
describe("MediaService convenience", () => {
  it("uploadFile builds an AssetCreateBlob with refIds + details from the input", async () => {
    let parsedBody: any = null;
    server.use(
      http.post("https://api.emporix.io/media/acme/assets", async ({ request }) => {
        const fd = await request.formData();
        const b = fd.get("body");
        if (typeof b === "string") parsedBody = JSON.parse(b);
        return HttpResponse.json({ id: "a" }, { status: 201 });
      }),
    );
    await svc().uploadFile({
      file: new File(["x"], "p.png", { type: "image/png" }),
      productId: "p1",
      filename: "p.png",
      mimeType: "image/png",
    });
    expect(parsedBody.type).toBe("BLOB");
    expect(parsedBody.access).toBe("PUBLIC");
    expect(parsedBody.refIds).toEqual([{ type: "PRODUCT", id: "p1" }]);
    expect(parsedBody.details).toEqual({ filename: "p.png", mimeType: "image/png" });
  });

  it("link builds an AssetCreateLink body", async () => {
    let body: any = null;
    server.use(
      http.post("https://api.emporix.io/media/acme/assets", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "a" }, { status: 201 });
      }),
    );
    await svc().link({ url: "https://cdn/i.jpg", productId: "p1" });
    expect(body).toMatchObject({
      type: "LINK",
      access: "PUBLIC",
      url: "https://cdn/i.jpg",
      refIds: [{ type: "PRODUCT", id: "p1" }],
    });
  });

  it("attachToProduct is idempotent (no duplicate PRODUCT refId)", async () => {
    let putBody: any = null;
    server.use(
      http.get("https://api.emporix.io/media/acme/assets/a", () =>
        HttpResponse.json({ id: "a", refIds: [{ type: "PRODUCT", id: "p1" }] }),
      ),
      http.put("https://api.emporix.io/media/acme/assets/a", async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ id: "a", refIds: putBody.refIds });
      }),
    );
    await svc().attachToProduct("a", "p1"); // already attached
    expect(putBody.refIds).toEqual([{ type: "PRODUCT", id: "p1" }]); // unchanged
    await svc().attachToProduct("a", "p2"); // new product
    expect(putBody.refIds).toEqual([
      { type: "PRODUCT", id: "p1" },
      { type: "PRODUCT", id: "p2" },
    ]);
  });

  it("detachFromProduct removes the matching PRODUCT refId", async () => {
    let putBody: any = null;
    server.use(
      http.get("https://api.emporix.io/media/acme/assets/a", () =>
        HttpResponse.json({
          id: "a",
          refIds: [
            { type: "PRODUCT", id: "p1" },
            { type: "PRODUCT", id: "p2" },
            { type: "CATEGORY", id: "c1" },
          ],
        }),
      ),
      http.put("https://api.emporix.io/media/acme/assets/a", async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ id: "a", refIds: putBody.refIds });
      }),
    );
    await svc().detachFromProduct("a", "p1");
    expect(putBody.refIds).toEqual([
      { type: "PRODUCT", id: "p2" },
      { type: "CATEGORY", id: "c1" },
    ]);
  });

  it("listForProduct passes the refIds.id filter as a query param (server-side filter happy path)", async () => {
    let query: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/media/acme/assets", ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "a", refIds: [{ type: "PRODUCT", id: "p1" }] }]);
      }),
    );
    const rows = await svc().listForProduct("p1");
    expect(query?.get("refIds.id")).toBe("p1");
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- media`
Expected: FAIL — the convenience methods don't exist yet.

- [ ] **Step 3: Implement the helpers**

In `packages/sdk/src/services/media.ts`, append inside the `MediaService`
class (after `remove(...)`):

```ts
  /** Multipart upload sugar: builds `AssetCreateBlob` from input. */
  async uploadFile(
    input: {
      file: Blob;
      productId?: string;
      filename?: string;
      mimeType?: string;
      access?: "PUBLIC" | "PRIVATE";
    },
    auth: AuthContext = SERVICE,
  ): Promise<{ id: string }> {
    const body: AssetCreateBlobInput = {
      type: "BLOB",
      access: input.access ?? "PUBLIC",
      ...(input.productId
        ? { refIds: [{ type: "PRODUCT", id: input.productId } as AssetRefId] }
        : {}),
      ...(input.filename || input.mimeType
        ? {
            details: {
              ...(input.filename ? { filename: input.filename } : {}),
              ...(input.mimeType ? { mimeType: input.mimeType } : {}),
            },
          }
        : {}),
    } as AssetCreateBlobInput;
    return this.create({ kind: "blob", file: input.file, body }, auth);
  }

  /** External-URL sugar: builds `AssetCreateLink`. */
  async link(
    input: { url: string; productId?: string; access?: "PUBLIC" | "PRIVATE" },
    auth: AuthContext = SERVICE,
  ): Promise<{ id: string }> {
    const body: AssetCreateLinkInput = {
      type: "LINK",
      access: input.access ?? "PUBLIC",
      url: input.url,
      ...(input.productId
        ? { refIds: [{ type: "PRODUCT", id: input.productId } as AssetRefId] }
        : {}),
    } as AssetCreateLinkInput;
    return this.create({ kind: "link", body }, auth);
  }

  /** Idempotently add a PRODUCT refId to an asset. */
  async attachToProduct(
    assetId: string,
    productId: string,
    auth: AuthContext = SERVICE,
  ): Promise<Asset> {
    const a = await this.get(assetId, auth);
    const refIds = ((a as { refIds?: AssetRefId[] }).refIds ?? []) as AssetRefId[];
    if (refIds.some((r) => isProductRef(r, productId))) return a;
    const next = [
      ...refIds,
      { type: "PRODUCT", id: productId } as AssetRefId,
    ];
    return this.update(assetId, { refIds: next } as AssetUpdateInput, auth);
  }

  /** Remove a PRODUCT refId from an asset (no-op if absent). */
  async detachFromProduct(
    assetId: string,
    productId: string,
    auth: AuthContext = SERVICE,
  ): Promise<Asset> {
    const a = await this.get(assetId, auth);
    const refIds = ((a as { refIds?: AssetRefId[] }).refIds ?? []) as AssetRefId[];
    const next = refIds.filter((r) => !isProductRef(r, productId));
    if (next.length === refIds.length) return a;
    return this.update(assetId, { refIds: next } as AssetUpdateInput, auth);
  }

  /** Convenience: list assets attached to a product. */
  async listForProduct(productId: string, auth: AuthContext = SERVICE): Promise<Asset[]> {
    return this.list({ "refIds.id": productId }, auth);
  }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @viu/emporix-sdk test -- media && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/media.ts packages/sdk/tests/services/media.test.ts
git commit -m "feat(media): convenience helpers (uploadFile, link, attach/detach, listForProduct)"
```

---

### Task 5: Remove broken `ProductService.media`

**Files:**
- Modify: `packages/sdk/src/services/product.ts:92-101` (delete the `readonly media = { … }` block)
- Modify: `packages/sdk/tests/services/facade-coverage.test.ts` (lines 48 + 136 + 140 — remove the now-irrelevant handler and assertion)

The `Media` type alias in `product.ts` and its `export type { Product, Media }` line in `index.ts` **stay** — they're a useful re-export of the generated `ProductMedia[number]` element type. Only the method is removed.

- [ ] **Step 1: Delete the `readonly media` block in `product.ts`**

In `packages/sdk/src/services/product.ts`, delete this block (currently at
the end of the class body, lines 92-101):

```ts
  /** Media sub-resource. */
  readonly media = {
    list: async (productId: string, auth: AuthContext = ANON): Promise<Media[]> =>
      this.ctx.http.request<Media[]>({
        method: "GET",
        path: `/product/${this.ctx.tenant}/products/${productId}/media`,
        auth,
      }),
  };
```

The class brace `}` directly follows the previous method.

- [ ] **Step 2: Drop the facade-coverage media handler + assertion**

In `packages/sdk/tests/services/facade-coverage.test.ts`:

Delete the msw handler at line 48:

```ts
  http.get("https://api.emporix.io/product/acme/products/p1/media", () =>
    HttpResponse.json([{ id: "m1", url: "http://x/i.png" }]),
  ),
```

Delete the assertion line at line 140:

```ts
    expect((await s().media.list("p1"))[0]?.url).toBe("http://x/i.png");
```

Rename the surrounding `it("getByCode/list/search/media", …)` (line 136) to
`it("getByCode/list/search", …)`.

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm --filter @viu/emporix-sdk test && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/services/product.ts packages/sdk/tests/services/facade-coverage.test.ts
git commit -m "feat(product)!: remove broken ProductService.media (use MediaService.listForProduct)"
```

The `!` in the message marks the breaking change (conventional-commits style).

---

### Task 6: React `useProductMedia(productId)` (thin hook)

**Files:**
- Create: `packages/react/src/hooks/use-product-media.ts`
- Modify: `packages/react/src/hooks/index.ts`, `packages/react/src/index.ts`
- Test: `packages/react/tests/use-product-media.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/use-product-media.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useProductMedia } from "../src/hooks/use-product-media";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "a", token_type: "Bearer", expires_in: 3600,
      refresh_token: "r", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", () =>
    HttpResponse.json({
      id: "p1",
      productMedia: [
        { id: "m1", url: "https://cdn/p1-1.jpg", contentType: "image/jpeg" },
        { id: "m2", url: "https://cdn/p1-2.jpg", contentType: "image/jpeg" },
      ],
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useProductMedia", () => {
  it("returns the productMedia array from the product query (no extra network call)", async () => {
    const { result } = renderHook(() => useProductMedia("p1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]?.id).toBe("m1");
  });

  it("returns undefined when the product is still loading", () => {
    const { result } = renderHook(() => useProductMedia("p1"), { wrapper: wrap() });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk-react test -- use-product-media`
Expected: FAIL — `useProductMedia` is not exported.

- [ ] **Step 3: Implement the hook**

Create `packages/react/src/hooks/use-product-media.ts`:

```ts
import type { UseQueryResult } from "@tanstack/react-query";
import type { Product } from "@viu/emporix-sdk";
import { useProduct } from "./queries";

type ProductMedia = NonNullable<
  Product extends { productMedia?: infer M } ? M : never
>;

/**
 * Reads `productMedia` from the existing product query — no Media-Service
 * call (those need a server-only scope). For admin/server flows, use
 * `client.media.listForProduct(productId)` instead.
 */
export function useProductMedia(productId: string): {
  data: ProductMedia | undefined;
  isLoading: boolean;
  error: unknown;
} {
  const q: UseQueryResult<Product> = useProduct(productId);
  const data = (q.data as { productMedia?: ProductMedia } | undefined)?.productMedia;
  return { data, isLoading: q.isLoading, error: q.error };
}
```

In `packages/react/src/hooks/index.ts`, add the export next to the existing
hook re-exports:

```ts
export { useMatchPrices } from "./use-match-prices";
export { useProductMedia } from "./use-product-media";
```

In `packages/react/src/index.ts`, add `useProductMedia` to the
`from "./hooks/index"` re-export block (next to `useMatchPrices`).

- [ ] **Step 4: Run tests + react typecheck**

Run: `pnpm build && pnpm --filter @viu/emporix-sdk-react test -- use-product-media && pnpm --filter @viu/emporix-sdk-react typecheck`
Expected: PASS, typecheck clean.

If branch coverage on `packages/react` drops below 80%, add a third focused
test (e.g. an error-propagation case where `/products/p1` returns a 500 and
`error` is defined). Do not lower the threshold.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-product-media.ts packages/react/src/hooks/index.ts \
  packages/react/src/index.ts packages/react/tests/use-product-media.test.tsx
git commit -m "feat(react): useProductMedia (reads from product.productMedia)"
```

---

### Task 7: Docs, changeset, green gate, finish

**Files:**
- Create: `docs/media.md`
- Create: `.changeset/media-service.md`

- [ ] **Step 1: Write `docs/media.md`**

Create `docs/media.md`:

```markdown
# Media

Emporix's Media service stores assets (binary files or external URLs) and
attaches them to resources (products, categories, brands…) via a single
`refIds` array on the asset itself. There is no `/products/{id}/media`
endpoint — association lives in the Media service.

## Auth model

All Media-service endpoints require a service-only scope
(`media.asset_manage` for writes, `media.asset_read` for reads). The SDK
defaults every Media call to a `service` `AuthContext`; storefronts running
in a browser cannot call the Media service directly. The product GET
response includes a read-only denormalized `productMedia` array — that is
the storefront's read path, and `useProductMedia(productId)` exposes it
without an extra network call.

## Upload a binary file and attach it to a product

```ts
const { id } = await client.media.uploadFile({
  file,                       // a Blob/File
  productId: "<productId>",
  filename: "hero.jpg",
  mimeType: "image/jpeg",
});
```

This sends `POST /media/{tenant}/assets` as `multipart/form-data` with the
file in the `file` part and a JSON `body` part carrying
`{ type: "BLOB", access: "PUBLIC", refIds: [{ type: "PRODUCT", id }],
details: { filename, mimeType } }`. The 201 response is `{ id }`.

## Link an external URL

```ts
const { id } = await client.media.link({
  url: "https://cdn.example/i.jpg",
  productId: "<productId>",
});
```

Sends `POST /media/{tenant}/assets` as JSON with
`{ type: "LINK", access: "PUBLIC", url, refIds: [...] }`.

## Attach / detach later

```ts
await client.media.attachToProduct(assetId, productId);   // idempotent
await client.media.detachFromProduct(assetId, productId); // no-op if absent
```

## List media for a product (admin/server)

```ts
const assets = await client.media.listForProduct(productId);
```

For the storefront read path, prefer `useProductMedia(productId)` or the
`product.productMedia` field on `client.products.get(productId)`.

## Out of scope

- `GET /assets/{id}/download` (PUBLIC redirect / PRIVATE bytes) — caller
  can use `asset.url` for PUBLIC assets or fetch the endpoint directly.
- Browser-side uploads — would require a BFF / token-exchange step.
```

- [ ] **Step 2: Add the changeset**

Create `.changeset/media-service.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add `MediaService`. `client.media.create({ kind: "blob" | "link", ... })`
posts to `POST /media/{tenant}/assets` (multipart for BLOB, JSON for LINK);
convenience helpers `uploadFile`, `link`, `attachToProduct`,
`detachFromProduct`, `listForProduct` wrap the common product-attachment
flows. `HttpClient` now passes `FormData` bodies through `fetch` verbatim
(no Content-Type/JSON-stringify). React adds a thin `useProductMedia(id)`
hook that reads `productMedia` from the existing product query (no
service-token call in the browser).

BREAKING: `ProductService.media` is removed — it called a path
(`/product/{tenant}/products/{id}/media`) that does not exist in the
Emporix Product API. Migrate to `client.media.listForProduct(productId)`
(admin/server) or read `product.productMedia` from `client.products.get`
(storefront).
```

- [ ] **Step 3: Full green gate**

Run:

```bash
pnpm build && pnpm typecheck && pnpm -r --filter "./packages/*" test
```

Expected: build ok; typecheck clean across sdk/react/examples; sdk + react
suites pass; coverage ≥80% on `packages/*`. If react branch coverage drops,
add focused tests at the dipped branch (do not lower the threshold).

- [ ] **Step 4: Commit**

```bash
git add docs/media.md .changeset/media-service.md
git commit -m "docs(media): canonical flows + auth model; add changeset"
```

- [ ] **Step 5: Finish the branch**

Use **superpowers:finishing-a-development-branch** (verify tests → 4-option menu → execute choice).

---

## Self-Review

- **Spec coverage:** §A codegen + `HttpClient` FormData → Tasks 1 + 2; §B
  `MediaService` CRUD + discriminated `create` → Task 3; convenience helpers
  (uploadFile/link/attach/detach/listForProduct) → Task 4; §C removal of
  `ProductService.media` → Task 5; §D `useProductMedia` thin hook → Task 6;
  testing per-task with msw; `docs/media.md` + changeset → Task 7. All four
  Decisions (1 both modes, 2 remove broken, 3 helpers, 4 thin React hook)
  are implemented.
- **Placeholder scan:** every code step contains complete code and exact
  commands; the only `<...>` markers (in `plan-media-type-bindings.md`) are
  resolved by the concrete grep in Task 1 Step 3 and recorded before any
  later task consumes them — the same accepted pattern as Plans A/B/D.
- **Type consistency:** `MediaService`, `Asset`, `AssetCreateBlobInput`,
  `AssetCreateLinkInput`, `AssetUpdateInput`, `AssetRefId`, `create({ kind:
  "blob"|"link" })`, `uploadFile`, `link`, `attachToProduct`,
  `detachFromProduct`, `listForProduct`, and `useProductMedia` are used
  identically across the service, client wiring, exports, tests, hook,
  docs, and changeset. `EmporixClient.media` matches the `mk("media")` +
  `ServiceName` addition.
