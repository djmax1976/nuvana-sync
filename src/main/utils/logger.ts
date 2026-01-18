/**
 * Structured Logger Utility
 *
 * Enterprise-grade structured logging with secret redaction.
 * Compliant with LM-001: Structured logs with severity levels.
 *
 * @module main/utils/logger
 * @security LM-001: Structured logging with secret redaction
 */

import { app } from 'electron';

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  /** Unique request/operation ID for tracing */
  traceId?: string;
  /** Service or module name */
  service?: string;
  /** Additional structured data */
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  version: string;
  context?: Record<string, unknown>;
}

// ============================================================================
// Secret Redaction Patterns
// ============================================================================

/**
 * Patterns for secret detection and redaction
 * LM-001: Centralized logging helpers that automatically redact secrets
 */
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // API keys
  { pattern: /Bearer\s+[a-zA-Z0-9\-_.]+/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /sk_[a-zA-Z0-9_\-.]+/gi, replacement: '[REDACTED_API_KEY]' },
  { pattern: /pk_[a-zA-Z0-9_\-.]+/gi, replacement: '[REDACTED_API_KEY]' },
  { pattern: /api[_-]?key["\s:=]+[a-zA-Z0-9\-_.]+/gi, replacement: 'apiKey: "[REDACTED]"' },
  // Passwords
  { pattern: /password["\s:=]+[^\s",}]+/gi, replacement: 'password: "[REDACTED]"' },
  // Tokens
  { pattern: /token["\s:=]+[a-zA-Z0-9\-_.]+/gi, replacement: 'token: "[REDACTED]"' },
  // Authorization headers
  { pattern: /Authorization["\s:=]+[^\s",}]+/gi, replacement: 'Authorization: "[REDACTED]"' },
];

/**
 * Keys to redact from context objects
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'apiKey',
  'apikey',
  'api_key',
  'secret',
  'token',
  'authorization',
  'auth',
  'credential',
  'credentials',
]);

// ============================================================================
// Logger Class
// ============================================================================

class Logger {
  private readonly serviceName: string;
  private readonly version: string;
  private minLevel: LogLevel;

  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(serviceName: string = 'nuvana') {
    this.serviceName = serviceName;
    this.version = app?.getVersion?.() || '1.0.0';
    this.minLevel = process.env.NODE_ENV === 'development' ? 'debug' : 'info';
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Redact secrets from a string
   */
  private redactString(str: string): string {
    let result = str;
    for (const { pattern, replacement } of SECRET_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  /**
   * Redact secrets from an object (deep clone)
   */
  private redactObject(obj: unknown, depth: number = 0): unknown {
    // Prevent infinite recursion
    if (depth > 10) return '[MAX_DEPTH_EXCEEDED]';

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.redactString(obj);
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }

    if (obj instanceof Date) {
      return obj.toISOString();
    }

    if (obj instanceof Error) {
      return {
        name: obj.name,
        message: this.redactString(obj.message),
        stack: obj.stack ? this.redactString(obj.stack) : undefined,
      };
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item, depth + 1));
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (SENSITIVE_KEYS.has(key.toLowerCase())) {
          result[key] = '[REDACTED]';
        } else {
          result[key] = this.redactObject(value, depth + 1);
        }
      }
      return result;
    }

    return '[UNKNOWN_TYPE]';
  }

  /**
   * Format and output a log entry
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    // Check if this level should be logged
    if (this.levelPriority[level] < this.levelPriority[this.minLevel]) {
      return;
    }

    // Build log entry
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: this.redactString(message),
      service: context?.service || this.serviceName,
      version: this.version,
    };

    // Add redacted context
    if (context) {
      const { service: _service, ...rest } = context;
      if (Object.keys(rest).length > 0) {
        entry.context = this.redactObject(rest) as Record<string, unknown>;
      }
    }

    // Output as JSON for structured logging
    const output = JSON.stringify(entry) + '\n';

    // Use process.stdout/stderr.write directly to handle EPIPE errors properly
    // The standard console methods can throw synchronously on broken pipes
    try {
      const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
      if (stream && !stream.destroyed) {
        stream.write(output, (err) => {
          // Ignore write errors (EPIPE, etc.) - callback handles async errors
        });
      }
    } catch {
      // Silently ignore write errors (EPIPE, etc.)
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Log error message
   */
  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  /**
   * Create a child logger with additional context
   */
  child(defaultContext: LogContext): ChildLogger {
    return new ChildLogger(this, defaultContext);
  }
}

/**
 * Child logger with preset context
 */
class ChildLogger {
  private parent: Logger;
  private defaultContext: LogContext;

  constructor(parent: Logger, defaultContext: LogContext) {
    this.parent = parent;
    this.defaultContext = defaultContext;
  }

  debug(message: string, context?: LogContext): void {
    this.parent.debug(message, { ...this.defaultContext, ...context });
  }

  info(message: string, context?: LogContext): void {
    this.parent.info(message, { ...this.defaultContext, ...context });
  }

  warn(message: string, context?: LogContext): void {
    this.parent.warn(message, { ...this.defaultContext, ...context });
  }

  error(message: string, context?: LogContext): void {
    this.parent.error(message, { ...this.defaultContext, ...context });
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Global logger instance
 * LM-001: Centralized logging helpers
 */
export const logger = new Logger();

/**
 * Create a child logger for a specific service
 */
export function createLogger(service: string): ChildLogger {
  return logger.child({ service });
}

export default logger;
