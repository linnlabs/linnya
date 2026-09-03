import type { JsonValue } from '@app/schemas';

import {
  readDiagnosticLogEnvelope,
  type DiagnosticLogEnvelope,
} from '../../../../../../shared/logging';

export function encodeAppServerDiagnosticLogPayload(
  envelope: DiagnosticLogEnvelope,
): JsonValue {
  return {
    type: envelope.type,
    version: envelope.version,
    record: {
      receivedAtIso: envelope.record.receivedAtIso,
      targetDate: envelope.record.targetDate,
      level: envelope.record.level,
      line: envelope.record.line,
      utf8Bytes: envelope.record.utf8Bytes,
    },
  };
}

export function parseAppServerDiagnosticLogPayload(value: unknown): DiagnosticLogEnvelope {
  const envelope = readDiagnosticLogEnvelope(value);
  if (!envelope) throw new Error('App Server diagnostic log payload 不合法');
  return envelope;
}
