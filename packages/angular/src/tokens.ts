import { InjectionToken } from "@angular/core";
import type { EmporixClient, EmporixStorage } from "@viu/emporix-sdk";

/**
 * The SDK client. A token rather than a service class because a class would
 * need `@Injectable()`, and a decorator would pull in the Angular compiler —
 * which is exactly what this package is built to avoid.
 */
export const EMPORIX_CLIENT = new InjectionToken<EmporixClient>("EMPORIX_CLIENT");

/** Persisted session state. Always present: `provideEmporix` supplies a memory fallback. */
export const EMPORIX_STORAGE = new InjectionToken<EmporixStorage>("EMPORIX_STORAGE");
