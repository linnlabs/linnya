import type { AuditEnvelope } from '../../contracts';
import type { AuditPort } from '../../ports';

export interface ConsoleAuditOptions {
  sink?: Pick<Console, 'info'>;
}

export function createConsoleAudit(options: ConsoleAuditOptions = {}): AuditPort {
  const sink = options.sink ?? console;
  return {
    emit(envelope: AuditEnvelope): void {
      sink.info('[linnkit:audit]', envelope);
    },
  };
}

export const consoleAudit = createConsoleAudit();
