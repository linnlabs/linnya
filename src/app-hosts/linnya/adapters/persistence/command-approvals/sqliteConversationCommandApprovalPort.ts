import type Database from 'better-sqlite3';

import {
  CommandApprovalRequestIdSchema,
  CommandConversationIdSchema,
  type CommandApprovalRequestId,
  type CommandConversationApprovalCandidate,
  type CommandConversationId,
} from '@app/schemas/commands';
import {
  ConversationCommandApprovalError,
  ConversationCommandApprovalSchema,
  type ConversationCommandApproval,
  type ConversationCommandApprovalFailureStage,
  type ConversationCommandApprovalDeletionPort,
  type ConversationCommandApprovalPort,
  type ConversationCommandApprovalSaveResult,
} from '../../../../../domains/commands';

interface ConversationCommandApprovalRow {
  approval_request_id: string;
  conversation_id: string;
  platform: string;
  shell_semantics_id: string;
  matcher_revision: string;
  token_prefix_json: string;
  approved_cwd: string;
  approved_at_ms: number;
}

function readStorageCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

function mapPersistenceFailure(
  error: unknown,
  stage: ConversationCommandApprovalFailureStage,
): ConversationCommandApprovalError {
  if (error instanceof ConversationCommandApprovalError) {
    return error;
  }
  return new ConversationCommandApprovalError(
    'conversation_approval_persistence_failed',
    stage,
    readStorageCode(error),
  );
}

function parseApprovalInput(input: unknown): ConversationCommandApproval {
  const parsed = ConversationCommandApprovalSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConversationCommandApprovalError('conversation_approval_invalid', 'remember');
  }
  return parsed.data;
}

function serializeTokenPrefix(candidate: CommandConversationApprovalCandidate): string {
  return JSON.stringify(candidate.token_prefix);
}

function hasSameCandidate(
  left: CommandConversationApprovalCandidate,
  right: CommandConversationApprovalCandidate,
): boolean {
  const leftContext = left.matching_context;
  const rightContext = right.matching_context;
  return leftContext.platform === rightContext.platform
    && leftContext.shell_semantics_id === rightContext.shell_semantics_id
    && leftContext.matcher_revision === rightContext.matcher_revision
    && left.token_prefix.length === right.token_prefix.length
    && left.token_prefix.every((token, index) => token === right.token_prefix[index]);
}

function mapRow(row: ConversationCommandApprovalRow): ConversationCommandApproval {
  let tokenPrefix: unknown;
  try {
    tokenPrefix = JSON.parse(row.token_prefix_json);
  } catch {
    throw new ConversationCommandApprovalError('conversation_approval_corrupt', 'list');
  }

  const parsed = ConversationCommandApprovalSchema.safeParse({
    approvalRequestId: row.approval_request_id,
    conversationId: row.conversation_id,
    candidate: {
      token_prefix: tokenPrefix,
      matching_context: {
        platform: row.platform,
        shell_semantics_id: row.shell_semantics_id,
        matcher_revision: row.matcher_revision,
      },
    },
    approvedCwd: row.approved_cwd,
    approvedAtMs: row.approved_at_ms,
  });
  if (!parsed.success) {
    throw new ConversationCommandApprovalError('conversation_approval_corrupt', 'list');
  }
  return parsed.data;
}

export class SqliteConversationCommandApprovalPort
implements ConversationCommandApprovalPort, ConversationCommandApprovalDeletionPort {
  constructor(private readonly db: Database.Database) {}

  async remember(
    input: ConversationCommandApproval,
  ): Promise<ConversationCommandApprovalSaveResult> {
    const approval = parseApprovalInput(input);
    try {
      const transaction = this.db.transaction(() => {
        const context = approval.candidate.matching_context;
        const tokenPrefixJson = serializeTokenPrefix(approval.candidate);
        const result = this.db.prepare<[
          CommandApprovalRequestId,
          CommandConversationId,
          string,
          string,
          string,
          string,
          string,
          number,
        ]>(`
          INSERT INTO conversation_command_approvals (
            approval_request_id,
            conversation_id,
            platform,
            shell_semantics_id,
            matcher_revision,
            token_prefix_json,
            approved_cwd,
            approved_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT DO NOTHING
        `).run(
          approval.approvalRequestId,
          approval.conversationId,
          context.platform,
          context.shell_semantics_id,
          context.matcher_revision,
          tokenPrefixJson,
          approval.approvedCwd,
          approval.approvedAtMs,
        );
        const stored = this.readByRequestId(approval.approvalRequestId, 'remember');
        if (!stored) {
          throw new ConversationCommandApprovalError(
            'conversation_approval_persistence_failed',
            'remember',
          );
        }
        if (
          stored.conversationId !== approval.conversationId
          || !hasSameCandidate(stored.candidate, approval.candidate)
          || stored.approvedCwd !== approval.approvedCwd
          || stored.approvedAtMs !== approval.approvedAtMs
        ) {
          throw new ConversationCommandApprovalError(
            'conversation_approval_identity_conflict',
            'remember',
          );
        }
        return {
          status: result.changes > 0 ? 'created' as const : 'existing' as const,
          approval: stored,
        };
      });
      return transaction();
    } catch (error: unknown) {
      const mapped = mapPersistenceFailure(error, 'remember');
      if (mapped.code === 'conversation_approval_corrupt') {
        throw new ConversationCommandApprovalError(
          mapped.code,
          'remember',
          mapped.storageCode,
        );
      }
      throw mapped;
    }
  }

  async listForConversation(
    conversationId: CommandConversationId,
  ): Promise<readonly ConversationCommandApproval[]> {
    const parsed = CommandConversationIdSchema.safeParse(conversationId);
    if (!parsed.success) {
      throw new ConversationCommandApprovalError('conversation_approval_invalid', 'list');
    }
    try {
      return this.db.prepare<[CommandConversationId], ConversationCommandApprovalRow>(`
        SELECT
          approval_request_id,
          conversation_id,
          platform,
          shell_semantics_id,
          matcher_revision,
          token_prefix_json,
          approved_cwd,
          approved_at_ms
        FROM conversation_command_approvals
        WHERE conversation_id = ?
        ORDER BY approved_at_ms ASC, approval_request_id ASC
      `).all(parsed.data).map(mapRow);
    } catch (error: unknown) {
      throw mapPersistenceFailure(error, 'list');
    }
  }

  async revoke(approvalRequestId: CommandApprovalRequestId): Promise<void> {
    const parsed = CommandApprovalRequestIdSchema.safeParse(approvalRequestId);
    if (!parsed.success) {
      throw new ConversationCommandApprovalError('conversation_approval_invalid', 'revoke');
    }
    try {
      this.db.prepare<[CommandApprovalRequestId]>(`
        DELETE FROM conversation_command_approvals
        WHERE approval_request_id = ?
      `).run(parsed.data);
    } catch (error: unknown) {
      throw mapPersistenceFailure(error, 'revoke');
    }
  }

  async deleteForConversation(conversationId: CommandConversationId): Promise<void> {
    const parsed = CommandConversationIdSchema.safeParse(conversationId);
    if (!parsed.success) {
      throw new ConversationCommandApprovalError('conversation_approval_invalid', 'delete');
    }
    try {
      this.db.prepare<[CommandConversationId]>(`
        DELETE FROM conversation_command_approvals
        WHERE conversation_id = ?
      `).run(parsed.data);
    } catch (error: unknown) {
      throw mapPersistenceFailure(error, 'delete');
    }
  }

  private readByRequestId(
    approvalRequestId: CommandApprovalRequestId,
    stage: ConversationCommandApprovalFailureStage,
  ): ConversationCommandApproval | null {
    const row = this.db.prepare<[
      CommandApprovalRequestId,
    ], ConversationCommandApprovalRow>(`
      SELECT
        approval_request_id,
        conversation_id,
        platform,
        shell_semantics_id,
        matcher_revision,
        token_prefix_json,
        approved_cwd,
        approved_at_ms
      FROM conversation_command_approvals
      WHERE approval_request_id = ?
      LIMIT 1
    `).get(approvalRequestId);
    if (!row) {
      return null;
    }
    try {
      return mapRow(row);
    } catch (error: unknown) {
      if (
        error instanceof ConversationCommandApprovalError
        && error.code === 'conversation_approval_corrupt'
      ) {
        throw new ConversationCommandApprovalError(error.code, stage);
      }
      throw error;
    }
  }
}
