import type Database from 'better-sqlite3';
import type { RunDescriptor } from '../../../application/run-resumption';

export function recordRunCommandPermission(db: Database.Database, descriptor: RunDescriptor): void {
  if (descriptor.child) return;
  const permission = descriptor.commandPermission;
  const snapshot = permission.status === 'available' ? permission.snapshot : undefined;
  db.prepare(`
    INSERT INTO conversation_run_command_permissions (
      run_id, conversation_id, captured_at_ms, permission_level, source
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    descriptor.runId,
    descriptor.conversationId,
    snapshot?.captured_at_ms ?? descriptor.createdAt,
    snapshot?.permission_level ?? null,
    snapshot?.source ?? null,
  );
}
