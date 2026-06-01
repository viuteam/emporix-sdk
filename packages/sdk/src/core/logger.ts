/** Log severity, low → high. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

/** Numeric ordering used for fast comparison. */
export const LEVEL: Record<LogLevel, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 60,
};

/** Services that bind their own logger and are independently level-controllable. */
export type ServiceName =
  | "customer"
  | "product"
  | "category"
  | "cart"
  | "checkout"
  | "payment"
  | "price"
  | "media"
  | "segment"
  | "site"
  | "session-context"
  | "customer-management"
  | "iam"
  | "orders"
  | "sales-orders"
  | "availability"
  | "configuration"
  | "shopping-list"
  | "ai-rag-indexer"
  | "sequential-id"
  | "fee"
  | "webhook"
  | "schema"
  | "ai"
  | "tax"
  | "coupon"
  | "reward-points"
  | "brand"
  | "label"
  | "country"
  | "currency"
  | "shipping"
  | "returns"
  | "sepa-export"
  | "indexing"
  | "unit-handling"
  | "http"
  | "auth";

/** Arbitrary structured fields attached to a log line. */
export interface LogFields { [key: string]: unknown; }

/** The logger contract consumers may implement or swap. */
export interface Logger {
  level: LogLevel;
  isLevelEnabled(level: LogLevel): boolean;
  trace(msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

/** Object form of logger configuration. */
export interface LoggerObjectConfig {
  level?: LogLevel;
  services?: Partial<Record<ServiceName, LogLevel>>;
  pretty?: boolean;
  redact?: string[];
}

/** `false` → noop logger; `Logger` → user-supplied; object → built-in console logger. */
export type LoggerConfig = false | Logger | LoggerObjectConfig;

function isValidLevel(v: string | undefined): v is LogLevel {
  return v !== undefined && v in LEVEL;
}

/** Browser-safe env read — `process` is undefined in browsers/edge runtimes. */
function readEnv(name: string): string | undefined {
  try {
    return typeof process !== "undefined" && process.env ? process.env[name] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the effective level per service following:
 * env per-service > env global > config.services[svc] > config.level > "warn".
 * Runtime `set()` mutates programmatic levels but never overrides env-set ones
 * unless `force` is passed.
 */
export class LevelResolver {
  private cfgLevel: LogLevel;
  private cfgServices: Partial<Record<ServiceName, LogLevel>>;
  private forcedServices: Partial<Record<ServiceName, LogLevel>> = {};
  private forcedGlobal: LogLevel | undefined;
  private warned = false;

  constructor(
    cfg: LoggerObjectConfig,
    private readonly warn: (msg: string) => void = () => {},
  ) {
    this.cfgLevel = cfg.level ?? "warn";
    this.cfgServices = { ...cfg.services };
  }

  private envFor(svc: ServiceName): LogLevel | undefined {
    const raw = readEnv(`EMPORIX_LOG_LEVEL_${svc.toUpperCase()}`);
    if (raw === undefined) return undefined;
    if (isValidLevel(raw)) return raw;
    if (!this.warned) {
      this.warned = true;
      this.warn(`Invalid EMPORIX_LOG_LEVEL_${svc.toUpperCase()}="${raw}" ignored`);
    }
    return undefined;
  }

  private envGlobal(): LogLevel | undefined {
    const raw = readEnv("EMPORIX_LOG_LEVEL");
    if (raw === undefined) return undefined;
    if (isValidLevel(raw)) return raw;
    if (!this.warned) {
      this.warned = true;
      this.warn(`Invalid EMPORIX_LOG_LEVEL="${raw}" ignored`);
    }
    return undefined;
  }

  /**
   * Effective level for a service. Forced overrides (from `set(..., force)`)
   * take precedence over env vars; otherwise env > programmatic config.
   */
  get(svc: ServiceName): LogLevel {
    return (
      this.forcedServices[svc] ??
      this.envFor(svc) ??
      this.forcedGlobal ??
      this.envGlobal() ??
      this.cfgServices[svc] ??
      this.cfgLevel ??
      "warn"
    );
  }

  /** Numeric effective level for a service. */
  numericLevel(svc: ServiceName): number {
    return LEVEL[this.get(svc)];
  }

  /** True if `svc`'s effective level allows emitting at `at`. */
  isAtLeast(svc: ServiceName, at: LogLevel): boolean {
    return this.numericLevel(svc) <= LEVEL[at];
  }

  /** Mutates programmatic level (global or one service). Env-set levels are sticky unless `force`. */
  set(level: LogLevel, svc?: ServiceName, force = false): void {
    if (svc) {
      const envBound = readEnv(`EMPORIX_LOG_LEVEL_${svc.toUpperCase()}`) !== undefined;
      if (envBound && !force) {
        this.warn(`Level for "${svc}" is env-controlled; pass force to override`);
        return;
      }
      if (force) this.forcedServices[svc] = level;
      else this.cfgServices[svc] = level;
    } else {
      const envBound = readEnv("EMPORIX_LOG_LEVEL") !== undefined;
      if (envBound && !force) {
        this.warn("Global level is env-controlled; pass force to override");
        return;
      }
      if (force) this.forcedGlobal = level;
      else this.cfgLevel = level;
    }
  }
}

/** Default redaction floor — never reducible. */
const DEFAULT_REDACT = new Set([
  "authorization", "password", "oldpassword", "newpassword", "clientsecret",
  "secret", "access_token", "refresh_token", "customertoken", "saastoken",
  "saas-token", "bearertoken", "apikey", "token",
]);

/** Deep-clones `value`, replacing redacted keys with a mask. AuthContext token is stripped. */
export function redact(value: unknown, extra: string[] = []): unknown {
  const keys = new Set(DEFAULT_REDACT);
  for (const k of extra) keys.add(k.toLowerCase());
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const src = v as Record<string, unknown>;
      // AuthContext: keep only `kind`.
      if (typeof src.kind === "string" && "token" in src) return { kind: src.kind };
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(src)) {
        if (keys.has(k.toLowerCase())) {
          out[k] =
            k.toLowerCase() === "authorization" && typeof val === "string"
              ? "Bearer ***redacted***"
              : "***redacted***";
        } else {
          out[k] = walk(val);
        }
      }
      return out;
    }
    return v;
  };
  return walk(value);
}

interface Sink {
  log: (...a: unknown[]) => void;
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
}

const EMIT: Record<Exclude<LogLevel, "silent">, number> = {
  trace: LEVEL.trace, debug: LEVEL.debug, info: LEVEL.info, warn: LEVEL.warn, error: LEVEL.error,
};

abstract class BaseLogger implements Logger {
  constructor(
    protected readonly resolver: LevelResolver,
    protected readonly bindings: LogFields,
    protected readonly extraRedact: string[],
  ) {}
  private svc(): ServiceName {
    return (this.bindings.service as ServiceName) ?? "http";
  }
  get level(): LogLevel {
    return this.resolver.get(this.svc());
  }
  isLevelEnabled(level: LogLevel): boolean {
    return this.resolver.isAtLeast(this.svc(), level);
  }
  protected abstract emit(
    level: Exclude<LogLevel, "silent">,
    msg: string,
    fields: LogFields,
  ): void;
  private at(level: Exclude<LogLevel, "silent">, msg: string, fields?: LogFields): void {
    if (this.resolver.numericLevel(this.svc()) > EMIT[level]) return;
    const merged = { ...this.bindings, ...(fields ?? {}) };
    this.emit(level, msg, redact(merged, this.extraRedact) as LogFields);
  }
  trace(m: string, f?: LogFields): void { this.at("trace", m, f); }
  debug(m: string, f?: LogFields): void { this.at("debug", m, f); }
  info(m: string, f?: LogFields): void { this.at("info", m, f); }
  warn(m: string, f?: LogFields): void { this.at("warn", m, f); }
  error(m: string, f?: LogFields): void { this.at("error", m, f); }
  abstract child(bindings: LogFields): Logger;
}

class ConsoleLogger extends BaseLogger {
  constructor(
    resolver: LevelResolver,
    bindings: LogFields,
    extra: string[],
    private readonly sink: Sink,
    private readonly pretty: boolean,
  ) {
    super(resolver, bindings, extra);
  }
  protected emit(level: Exclude<LogLevel, "silent">, msg: string, fields: LogFields): void {
    if (this.pretty) {
      const fn =
        level === "error" ? this.sink.error
        : level === "warn" ? this.sink.warn
        : level === "info" ? this.sink.info
        : this.sink.log;
      fn(`[${level}] ${msg}`, fields);
    } else {
      this.sink.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
    }
  }
  child(bindings: LogFields): Logger {
    return new ConsoleLogger(
      this.resolver,
      { ...this.bindings, ...bindings },
      this.extraRedact,
      this.sink,
      this.pretty,
    );
  }
}

class NoopLogger implements Logger {
  level: LogLevel = "silent";
  isLevelEnabled(): boolean { return false; }
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger { return this; }
}

/** Creates the built-in console logger. `opts.sink` overrides `console` (used in tests). */
export function createConsoleLogger(
  resolver: LevelResolver,
  bindings: LogFields = {},
  opts: { pretty?: boolean; redact?: string[]; sink?: Sink } = {},
): Logger {
  const pretty = opts.pretty ?? readEnv("NODE_ENV") !== "production";
  const sink: Sink = opts.sink ?? {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  return new ConsoleLogger(resolver, bindings, opts.redact ?? [], sink, pretty);
}

/** Creates a logger that discards everything. */
export function createNoopLogger(): Logger {
  return new NoopLogger();
}
