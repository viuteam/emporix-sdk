import { version } from "../package.json";

/**
 * The published `@viu/emporix-sdk` version, surfaced on every log line as
 * `sdkVersion`. Read from `package.json` so it always matches the released
 * package; esbuild inlines the literal at build time (browser-safe — no
 * runtime filesystem access).
 */
export const SDK_VERSION: string = version;
