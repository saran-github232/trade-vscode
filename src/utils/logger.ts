/**
 * Structured logger with sensitive-data protection.
 *
 * Every message is passed through `redact()` before being emitted, so API
 * keys, tokens, and other secret-shaped substrings can never reach a log
 * sink (console, file, or shipped telemetry).
 */

/** Log severity levels, ordered. */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Where a log line goes. Injectable for tests. */
export interface LogSink {
  write(level: LogLevel, line: string): void;
}

/** Default sink writes to console with a level prefix. */
export const consoleSink: LogSink = {
  write(level, line) {
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`[${level}] ${line}`);
  },
};

/** Collecting sink for tests. */
export class MemorySink implements LogSink {
  readonly lines: { level: LogLevel; line: string }[] = [];
  write(level: LogLevel, line: string): void {
    this.lines.push({ level, line });
  }
}

/**
 * Replace secret-shaped content with a redaction marker.
 * Handles common key formats and explicit key=value pairs.
 */
export function redact(input: string): string {
  return (
    input
      // Common API key prefixes with trailing material.
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
      .replace(/\bghp_[A-Za-z0-9]{8,}\b/g, "[REDACTED]")
      .replace(/\bxoxb-[A-Za-z0-9-]{8,}\b/g, "[REDACTED]")
      // key=value / key: value where the key name signals a secret.
      .replace(
        /\b(api[-_]?key|apikey|token|secret|password|authorization|bearer)\b(["']?\s*[:=]\s*["']?)([^\s",}]+)/gi,
        (_m, k, sep) => `${k}${sep}[REDACTED]`,
      )
      // Bearer tokens.
      .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [REDACTED]")
  );
}

/** Redact any value, including nested objects, by serializing first. */
export function redactValue(value: unknown): string {
  let serialized: string;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  return redact(serialized);
}

/** A logger bound to a minimum level and sink. */
export class Logger {
  constructor(
    private readonly minLevel: LogLevel = "info",
    private readonly sink: LogSink = consoleSink,
    private readonly scope: string = "",
  ) {}

  /** Derive a child logger with an additional scope prefix. */
  child(scope: string): Logger {
    return new Logger(this.minLevel, this.sink, this.scope ? `${this.scope}.${scope}` : scope);
  }

  debug(msg: string, extra?: unknown): void {
    this.emit("debug", msg, extra);
  }
  info(msg: string, extra?: unknown): void {
    this.emit("info", msg, extra);
  }
  warn(msg: string, extra?: unknown): void {
    this.emit("warn", msg, extra);
  }
  error(msg: string, extra?: unknown): void {
    this.emit("error", msg, extra);
  }

  private emit(level: LogLevel, msg: string, extra?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const scopePrefix = this.scope ? `[${this.scope}] ` : "";
    const extraPart = extra === undefined ? "" : ` ${redactValue(extra)}`;
    this.sink.write(level, redact(`${scopePrefix}${msg}${extraPart}`));
  }
}

/** Root logger factory. */
export function createLogger(scope?: string, level: LogLevel = "info", sink: LogSink = consoleSink): Logger {
  return new Logger(level, sink, scope);
}
