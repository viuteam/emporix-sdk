/**
 * The read and mutation injectables.
 *
 * Grouped by area rather than one file per injectable: files that change together
 * live together, and the `site` / `mode` / `staleTime` choices within an area are
 * only reviewable side by side.
 *
 * Every one is a thin wrapper over `injectEmporixQuery` or
 * `injectEmporixInfinite`. That is deliberate — the auth resolution, the cache key
 * and the `enabled` gate live in one place, so an area cannot drift from the rest.
 */
export * from "./catalog";
export * from "./price";
export * from "./cart";
export * from "./checkout";
export * from "./customer";
export * from "./orders";
export * from "./loyalty";
export * from "./returns";
export * from "./shopping-lists";
export * from "./site";
