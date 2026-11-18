import { createHash } from 'node:crypto';

import {
  resolveConversationCommandPermission,
  type CommandPermissionLevel,
  type ConversationCommandPermissionChange,
  type ConversationCommandPermissionSelection,
} from '@app/schemas/commands';

export function planCommandPermissionChange(input: {
  current: ConversationCommandPermissionSelection;
  next: CommandPermissionLevel | null;
  globalLevel: CommandPermissionLevel;
  origin: ConversationCommandPermissionChange['origin'];
  at: number;
}): ConversationCommandPermissionChange | null {
  if (input.current.permission_level === input.next) return null;
  return {
    revision: input.current.revision + 1,
    changed_at_ms: input.at,
    origin: input.origin,
    previous_selection: input.current.permission_level,
    next_selection: input.next,
    previous_level: resolveConversationCommandPermission(input.globalLevel, input.current.permission_level).permission_level,
    next_level: resolveConversationCommandPermission(input.globalLevel, input.next).permission_level,
  };
}

export function fingerprintCommandPermissionReduction(
  affected: ReadonlyArray<{ readonly id: string; readonly revision: number; readonly createdAt: number }>,
): string {
  // 数量相同的两次预览可能包含不同对话，确认必须绑定身份与版本。
  const identities = affected.map(({ id, revision, createdAt }) => [id, revision, createdAt]).sort();
  return createHash('sha256').update(JSON.stringify(identities)).digest('hex');
}
