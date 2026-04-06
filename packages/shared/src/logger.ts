import { scrubSecrets } from "./security.js";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  jobId?: string;
  duration?: number;
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

export function createLogger(context?: { jobId?: string }): Logger {
  function log(
    level: LogEntry["level"],
    message: string,
    extra?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: scrubSecrets(message),
      ...context,
    };
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (typeof v === "string") {
          entry[k] = scrubSecrets(v);
        } else if (v instanceof Error) {
          entry[k] = scrubSecrets(v.message);
        } else if (typeof v === "object" && v !== null) {
          entry[k] = scrubSecrets(JSON.stringify(v));
        } else {
          entry[k] = v;
        }
      }
    }
    process.stdout.write(JSON.stringify(entry) + "\n");
  }

  return {
    info: (message, extra?) => log("info", message, extra),
    warn: (message, extra?) => log("warn", message, extra),
    error: (message, extra?) => log("error", message, extra),
  };
}
