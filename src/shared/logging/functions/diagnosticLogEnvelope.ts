import {
  DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS,
  type DiagnosticLogEnvelope,
  type DiagnosticLogLevel,
  type DiagnosticLogRecord,
} from '../definitions/diagnosticLogContract';

const encoder = new TextEncoder();
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function isDiagnosticLogLevel(value: unknown): value is DiagnosticLogLevel {
  return value === 'DEBUG' || value === 'INFO' || value === 'WARN' || value === 'ERROR';
}

function readRecord(value: unknown): DiagnosticLogRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const receivedAtIso = Reflect.get(value, 'receivedAtIso');
  const targetDate = Reflect.get(value, 'targetDate');
  const level = Reflect.get(value, 'level');
  const line = Reflect.get(value, 'line');
  const utf8Bytes = Reflect.get(value, 'utf8Bytes');
  if (
    typeof receivedAtIso !== 'string'
    || Number.isNaN(Date.parse(receivedAtIso))
    || typeof targetDate !== 'string'
    || !LOCAL_DATE.test(targetDate)
    || !isDiagnosticLogLevel(level)
    || typeof line !== 'string'
    || /[\r\n]/u.test(line)
    || !Number.isSafeInteger(utf8Bytes)
  ) return undefined;

  const actualBytes = encoder.encode(line).byteLength + 1;
  if (
    utf8Bytes !== actualBytes
    || actualBytes > DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS.maxRecordBytes
  ) return undefined;

  return {
    receivedAtIso,
    targetDate,
    level,
    line,
    utf8Bytes,
  };
}

export function createDiagnosticLogEnvelope(record: DiagnosticLogRecord): DiagnosticLogEnvelope {
  return { type: 'diagnostic_log', version: 1, record };
}

export function readDiagnosticLogEnvelope(value: unknown): DiagnosticLogEnvelope | undefined {
  if (
    typeof value !== 'object'
    || value === null
    || Reflect.get(value, 'type') !== 'diagnostic_log'
    || Reflect.get(value, 'version') !== 1
  ) return undefined;
  const record = readRecord(Reflect.get(value, 'record'));
  return record ? createDiagnosticLogEnvelope(record) : undefined;
}
