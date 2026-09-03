export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

type LogPayload = Record<string, unknown> | undefined;

const LOG_LEVEL_NAMES: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};

const DEFAULT_LEVEL = resolveDefaultLogLevel();

function readProcessEnv(name: string): string | undefined {
  if (typeof process === 'undefined') {
    return undefined;
  }
  return process.env[name];
}

function resolveDefaultLogLevel(): LogLevel {
  const configured = readProcessEnv('LINNKIT_LOG_LEVEL')?.trim().toLowerCase();
  if (!configured) {
    return LogLevel.WARN;
  }
  return LOG_LEVEL_NAMES[configured] ?? LogLevel.WARN;
}

function formatPrefix(level: keyof Console, moduleName: string): string {
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] [${moduleName}]`;
}

function shouldLog(level: LogLevel): boolean {
  return level >= DEFAULT_LEVEL;
}

export class Logger {
  constructor(private readonly moduleName: string) {}

  debug(message: string, data?: LogPayload): void {
    this.log(LogLevel.DEBUG, 'debug', message, data);
  }

  info(message: string, data?: LogPayload): void {
    this.log(LogLevel.INFO, 'info', message, data);
  }

  warn(message: string, data?: LogPayload): void {
    this.log(LogLevel.WARN, 'warn', message, data);
  }

  error(message: string, data?: LogPayload): void {
    this.log(LogLevel.ERROR, 'error', message, data);
  }

  private log(level: LogLevel, method: keyof Console, message: string, data?: LogPayload): void {
    if (!shouldLog(level)) {
      return;
    }
    const prefix = formatPrefix(method, this.moduleName);
    const fullMessage = `${prefix} ${message}`;
    if (data === undefined) {
      switch (method) {
        case 'debug':
          console.debug(fullMessage);
          break;
        case 'info':
          console.info(fullMessage);
          break;
        case 'warn':
          console.warn(fullMessage);
          break;
        case 'error':
          console.error(fullMessage);
          break;
        default:
          console.log(fullMessage);
      }
      return;
    }
    switch (method) {
      case 'debug':
        console.debug(fullMessage, data);
        break;
      case 'info':
        console.info(fullMessage, data);
        break;
      case 'warn':
        console.warn(fullMessage, data);
        break;
      case 'error':
        console.error(fullMessage, data);
        break;
      default:
        console.log(fullMessage, data);
    }
  }
}
