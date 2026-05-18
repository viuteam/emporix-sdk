import {
  type Logger,
  type LogFields,
  type LogLevel,
  type LevelResolver,
  type ServiceName,
  redact,
} from "../../src/core/logger";

export interface MemoryEntry {
  level: LogLevel;
  msg: string;
  service: string | undefined;
  fields: LogFields;
}

/** Test logger capturing emitted entries; honours the resolver and redaction. */
export class MemoryLogger implements Logger {
  readonly entries: MemoryEntry[];
  constructor(
    private readonly resolver: LevelResolver,
    private readonly bindings: LogFields = {},
    entries: MemoryEntry[] = [],
  ) {
    this.entries = entries;
  }
  private svc(): ServiceName {
    return (this.bindings.service as ServiceName) ?? "http";
  }
  get level(): LogLevel {
    return this.resolver.get(this.svc());
  }
  isLevelEnabled(l: LogLevel): boolean {
    return this.resolver.isAtLeast(this.svc(), l);
  }
  private at(level: LogLevel, msg: string, fields?: LogFields) {
    if (level === "silent" || !this.isLevelEnabled(level)) return;
    const merged = { ...this.bindings, ...(fields ?? {}) };
    this.entries.push({
      level,
      msg,
      service: this.bindings.service as string | undefined,
      fields: redact(merged) as LogFields,
    });
  }
  trace(m: string, f?: LogFields) { this.at("trace", m, f); }
  debug(m: string, f?: LogFields) { this.at("debug", m, f); }
  info(m: string, f?: LogFields) { this.at("info", m, f); }
  warn(m: string, f?: LogFields) { this.at("warn", m, f); }
  error(m: string, f?: LogFields) { this.at("error", m, f); }
  child(bindings: LogFields): Logger {
    return new MemoryLogger(this.resolver, { ...this.bindings, ...bindings }, this.entries);
  }
}
