/**
 * Per-request memoization without React.
 *
 * `react`'s `cache()` is the obvious tool and is deliberately not used: this
 * package has no React dependency and keeps it that way (see
 * `tests/no-react-dependency.test.ts`). `AsyncLocalStorage` is no help either —
 * it needs someone to open the context, and Next gives a library no hook that
 * wraps a render.
 *
 * What is left is an anchor Next already scopes to the request: the object
 * `await cookies()` returns. A `WeakMap` keyed on it gives exactly request
 * lifetime, and the entry dies with the request because nothing else holds the
 * anchor.
 *
 * The stored value is the **promise**, not the result — that is what makes two
 * concurrent callers share one build instead of racing.
 */
const scopes = new WeakMap<object, Map<string, Promise<unknown>>>();

export function requestScoped<T>(
  anchor: object,
  key: string,
  build: () => Promise<T>,
): Promise<T> {
  let slot = scopes.get(anchor);
  if (slot === undefined) {
    slot = new Map();
    scopes.set(anchor, slot);
  }
  const hit = slot.get(key);
  if (hit !== undefined) return hit as Promise<T>;

  // A rejection is NOT cached: a transient store outage would otherwise poison
  // every later read in the same request, turning one blip into a broken page.
  const made = build().catch((e: unknown) => {
    slot.delete(key);
    throw e;
  });
  slot.set(key, made);
  return made;
}
