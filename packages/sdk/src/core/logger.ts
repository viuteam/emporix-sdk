/** Log severity, low → high. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

/** Numeric ordering used for fast comparison. */
export const LEVEL: Record<LogLevel, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 60,
};

/** Services that bind their own logger and are independently level-controllable. */
export type ServiceName = "customer" | "product" | "category" | "cart" | "http" | "auth";

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
    const raw = process.env[`EMPORIX_LOG_LEVEL_${svc.toUpperCase()}`];
    if (raw === undefined) return undefined;
    if (isValidLevel(raw)) return raw;
    if (!this.warned) {
      this.warned = true;
      this.warn(`Invalid EMPORIX_LOG_LEVEL_${svc.toUpperCase()}="${raw}" ignored`);
    }
    return undefined;
  }

  private envGlobal(): LogLevel | undefined {
    const raw = process.env.EMPORIX_LOG_LEVEL;
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
      const envBound = process.env[`EMPORIX_LOG_LEVEL_${svc.toUpperCase()}`] !== undefined;
      if (envBound && !force) {
        this.warn(`Level for "${svc}" is env-controlled; pass force to override`);
        return;
      }
      if (force) this.forcedServices[svc] = level;
      else this.cfgServices[svc] = level;
    } else {
      const envBound = process.env.EMPORIX_LOG_LEVEL !== undefined;
      if (envBound && !force) {
        this.warn("Global level is env-controlled; pass force to override");
        return;
      }
      if (force) this.forcedGlobal = level;
      else this.cfgLevel = level;
    }
  }
}
