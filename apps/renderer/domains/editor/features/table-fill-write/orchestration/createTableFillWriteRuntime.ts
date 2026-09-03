import {
  writeTableCellByIdentity,
  type TableCellAppendStateTracker,
  type TableCellWriteOperationResult,
} from '../../../blocks/TableBlock/ai/tableCellWriteOperation';
import { replaceTableOutputPlaceholders } from '../../../blocks/TableBlock/ai/tableOutputPlaceholders';
import type {
  BeginTableFillWriteSessionInput,
  TableFillWriteCommand,
  TableFillWritePort,
  TableFillWriteRuntime,
  TableFillWriteSessionOwner,
  TableFillWriteUnitTarget,
} from '../definitions/tableFillWrite';

type WriteTarget = typeof writeTableCellByIdentity;
type SessionStatus = 'active' | 'ending' | 'cancelled';

interface TableFillWriteSessionState {
  readonly input: BeginTableFillWriteSessionInput;
  readonly targets: ReadonlyMap<string, TableFillWriteUnitTarget>;
  readonly appendState: TableCellAppendStateTracker;
  tail: Promise<void>;
  status: SessionStatus;
  abortListener?: () => void;
}

export interface CreateTableFillWriteRuntimeOptions {
  writeTarget?: (
    params: Parameters<WriteTarget>[0],
  ) => TableCellWriteOperationResult | Promise<TableCellWriteOperationResult>;
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`[TableFillWrite] ${label} must not be empty`);
  return normalized;
}

function requireCoordinate(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`[TableFillWrite] ${label} must be a non-negative integer`);
  }
  return value;
}

function buildTargets(units: readonly TableFillWriteUnitTarget[]): ReadonlyMap<string, TableFillWriteUnitTarget> {
  if (units.length === 0) {
    throw new Error('[TableFillWrite] units must not be empty');
  }

  const targets = new Map<string, TableFillWriteUnitTarget>();
  for (const unit of units) {
    const unitId = requireNonEmpty(unit.unitId, 'unitId');
    if (targets.has(unitId)) {
      throw new Error(`[TableFillWrite] duplicate unitId: ${unitId}`);
    }
    targets.set(unitId, {
      ...unit,
      unitId,
      rowIndex: requireCoordinate(unit.rowIndex, `unit ${unitId} rowIndex`),
      colIndex: requireCoordinate(unit.colIndex, `unit ${unitId} colIndex`),
    });
  }
  return targets;
}

function requireSession(
  sessions: ReadonlyMap<string, TableFillWriteSessionState>,
  sessionId: string,
): TableFillWriteSessionState {
  const normalizedId = requireNonEmpty(sessionId, 'sessionId');
  const session = sessions.get(normalizedId);
  if (!session) {
    throw new Error(`[TableFillWrite] session not found: ${normalizedId}`);
  }
  return session;
}

function requireAcceptingSession(
  sessions: ReadonlyMap<string, TableFillWriteSessionState>,
  command: TableFillWriteCommand,
): { session: TableFillWriteSessionState; target: TableFillWriteUnitTarget } {
  const session = requireSession(sessions, command.sessionId);
  if (session.status === 'cancelled') {
    throw createAbortError(`[TableFillWrite] session cancelled: ${command.sessionId}`);
  }
  if (session.status === 'ending') {
    throw new Error(`[TableFillWrite] session is ending: ${command.sessionId}`);
  }

  const unitId = requireNonEmpty(command.unitId, 'unitId');
  const target = session.targets.get(unitId);
  if (!target) {
    throw new Error(`[TableFillWrite] unit not found in session ${command.sessionId}: ${unitId}`);
  }
  if (command.content.length === 0) {
    throw new Error(`[TableFillWrite] content must not be empty for unit ${unitId}`);
  }
  if (command.mode !== 'replace' && command.mode !== 'append') {
    throw new Error(`[TableFillWrite] unsupported mode for unit ${unitId}: ${String(command.mode)}`);
  }

  return { session, target };
}

export function createTableFillWriteRuntime(
  options: CreateTableFillWriteRuntimeOptions = {},
): TableFillWriteRuntime {
  const writeTarget = options.writeTarget ?? writeTableCellByIdentity;
  const activeSessions = new Map<string, TableFillWriteSessionState>();

  const port: TableFillWritePort = {
    async enqueueWrite(command) {
      const { session, target } = requireAcceptingSession(activeSessions, command);
      const operation = session.tail.then(async () => {
        if (session.status === 'cancelled') {
          throw createAbortError(`[TableFillWrite] session cancelled before unit ${target.unitId}`);
        }

        const result = await writeTarget({
          editor: session.input.editor,
          tableInfo: {
            pos: session.input.table.initialPos,
            rootBlockId: session.input.table.rootBlockId,
          },
          rowIndex: target.rowIndex,
          colIndex: target.colIndex,
          content: replaceTableOutputPlaceholders(command.content, target.rowContext),
          mode: command.mode,
          appendState: session.appendState,
        });
        if (!result.ok) {
          throw new Error(
            `[TableFillWrite] write failed for session ${command.sessionId}, unit ${target.unitId}: ${result.reason}`,
          );
        }
      });

      // 单项失败只反馈给对应调用方，队列尾必须恢复为 fulfilled，保证后续 unit 继续执行。
      session.tail = operation.then(() => undefined, () => undefined);
      return operation;
    },

    async flush(sessionId) {
      const session = requireSession(activeSessions, sessionId);
      await session.tail;
    },

    async cancelSession(sessionId) {
      const session = requireSession(activeSessions, sessionId);
      session.status = 'cancelled';
      await session.tail;
    },

    async endSession(sessionId) {
      const normalizedId = requireNonEmpty(sessionId, 'sessionId');
      const session = requireSession(activeSessions, normalizedId);
      if (session.status === 'active') session.status = 'ending';
      await session.tail;
      if (session.abortListener && session.input.signal) {
        session.input.signal.removeEventListener('abort', session.abortListener);
      }
      activeSessions.delete(normalizedId);
    },
  };

  const sessions: TableFillWriteSessionOwner = {
    beginSession(input) {
      const sessionId = requireNonEmpty(input.sessionId, 'sessionId');
      if (activeSessions.has(sessionId)) {
        throw new Error(`[TableFillWrite] session already exists: ${sessionId}`);
      }
      requireNonEmpty(input.table.rootBlockId, 'rootBlockId');
      requireCoordinate(input.table.initialPos, 'initial table position');
      if (input.signal?.aborted) {
        throw createAbortError(`[TableFillWrite] session aborted before start: ${sessionId}`);
      }

      const session: TableFillWriteSessionState = {
        input: { ...input, sessionId },
        targets: buildTargets(input.units),
        appendState: {},
        tail: Promise.resolve(),
        status: 'active',
      };
      if (input.signal) {
        session.abortListener = () => {
          void port.cancelSession(sessionId);
        };
        input.signal.addEventListener('abort', session.abortListener, { once: true });
      }
      activeSessions.set(sessionId, session);
    },
  };

  return { port, sessions };
}

const defaultTableFillWriteRuntime = createTableFillWriteRuntime();

export const tableFillWritePort = defaultTableFillWriteRuntime.port;
export const tableFillWriteSessions = defaultTableFillWriteRuntime.sessions;
