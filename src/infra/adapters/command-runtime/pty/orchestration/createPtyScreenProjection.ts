import XtermHeadless from '@xterm/headless';
import type { Terminal as HeadlessTerminal } from '@xterm/headless';

import {
  createBoundedCommandTextProjection,
  validateCommandTextProjectionLimits,
} from '../../output';
import type {
  PtyScreenProjectionFinalization,
  PtyScreenProjectionOptions,
  PtyScreenProjectionSession,
  PtyScreenProjectionSnapshot,
} from '../definitions/ptyScreenProjection';
import {
  projectTerminalScreen,
} from '../functions/projectTerminalScreen';

const MAX_TERMINAL_DIMENSION = 32_767;
const MAX_HEADLESS_TERMINAL_CELLS = 2_000_000;
// @xterm/headless 6 的 Node 入口是 CommonJS；从默认模块对象读取构造器，才能同时满足
// Electron/tsup 的 CommonJS bundle 与测试 harness 的原生 ESM 加载方式。
const { Terminal } = XtermHeadless;

function requireDimension(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TERMINAL_DIMENSION) {
    throw new Error(`PTY screen ${name} must be an integer between 1 and 32767`);
  }
  return value;
}

function requireScrollback(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error('PTY screen scrollbackLines must be an integer between 0 and 10000');
  }
  return value;
}

function requireProjectedCellBudget(
  columns: number,
  rows: number,
  scrollbackLines: number,
): void {
  if (columns * (rows + scrollbackLines) > MAX_HEADLESS_TERMINAL_CELLS) {
    throw new Error('PTY screen dimensions exceed the bounded headless terminal budget');
  }
}

function writeTerminal(terminal: HeadlessTerminal, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      terminal.write(bytes, resolve);
    } catch (error: unknown) {
      reject(error);
    }
  });
}

/**
 * 每个 PTY execution 拥有一个 headless session。这里不注册 title/bell/onData listener，也不加载
 * clipboard、link、image、serialize 等 addon；OSC/查询序列只能改变 parser 内部状态或被忽略，
 * 不存在通向宿主剪贴板、网络、通知、标题和输入通道的副作用出口。
 */
export function createPtyScreenProjection(
  options: PtyScreenProjectionOptions,
): PtyScreenProjectionSession {
  const columns = requireDimension('columns', options.columns);
  const rows = requireDimension('rows', options.rows);
  const scrollback = requireScrollback(options.scrollbackLines);
  requireProjectedCellBudget(columns, rows, scrollback);
  const agentTextProjectionLimits = validateCommandTextProjectionLimits(
    options.agentTextProjectionLimits,
  );
  const terminal = new Terminal({
    allowProposedApi: true,
    cols: columns,
    rows,
    scrollback,
    disableStdin: true,
    logLevel: 'off',
  });
  let revision = 0;
  let operations = Promise.resolve();
  let operationFailure: unknown;
  let closing = false;
  let finalization: Promise<PtyScreenProjectionFinalization> | undefined;

  function enqueue(operation: () => Promise<void> | void): Promise<void> {
    if (closing) return Promise.reject(new Error('PTY screen projection is closed'));
    if (operationFailure !== undefined) return Promise.reject(operationFailure);
    const accepted = operations.then(operation);
    // 调用方需要观察本次失败，但内部队列不能永久停留在 rejected 状态；否则 finalize
    // 无法释放 terminal。真实 parser 失败另存为稳定事实，后续操作仍会拒绝。
    operations = accepted.then(
      () => undefined,
      (error: unknown) => {
        operationFailure ??= error;
      },
    );
    return accepted;
  }

  function requireOperationSucceeded(): void {
    if (operationFailure !== undefined) throw operationFailure;
  }

  function createSnapshot(
    scope: 'viewport' | 'terminal_window',
  ): PtyScreenProjectionSnapshot {
    const projected = projectTerminalScreen({ terminal, revision, scope });
    const stableText = projected.stableText;
    const boundedText = createBoundedCommandTextProjection(
      agentTextProjectionLimits,
    );
    boundedText.append(stableText);
    return Object.freeze({
      screen: projected.screen,
      agentText: Object.freeze({ mode: 'pty', terminal: boundedText.finalize() }),
      stableText,
    });
  }

  const session: PtyScreenProjectionSession = {
    write(transcriptBytes) {
      const ownedBytes = Uint8Array.from(transcriptBytes);
      return enqueue(async () => {
        await writeTerminal(terminal, ownedBytes);
        revision += 1;
      });
    },
    resize(nextColumns, nextRows) {
      if (closing) return Promise.reject(new Error('PTY screen projection is closed'));
      let acceptedColumns: number;
      let acceptedRows: number;
      try {
        acceptedColumns = requireDimension('columns', nextColumns);
        acceptedRows = requireDimension('rows', nextRows);
        // resize 是外部已接受的 PTY 事实，但 headless 派生层有更小的内存预算。
        // 在进入共享队列前拒绝，不能让一次超预算投影请求毒化后续 transcript。
        requireProjectedCellBudget(acceptedColumns, acceptedRows, scrollback);
      } catch (error: unknown) {
        return Promise.reject(error);
      }
      return enqueue(() => {
        terminal.resize(
          acceptedColumns,
          acceptedRows,
        );
        revision += 1;
      });
    },
    async snapshot() {
      await operations;
      requireOperationSucceeded();
      if (closing) throw new Error('PTY screen projection is closed');
      return createSnapshot('viewport');
    },
    finalize(sourceCompletion) {
      if (finalization) return finalization;
      closing = true;
      finalization = operations.then(() => {
        try {
          requireOperationSucceeded();
          const snapshot = createSnapshot('terminal_window');
          return Object.freeze({ ...snapshot, sourceCompletion });
        } finally {
          // DTO 生成自身也可能失败；terminal settlement 仍必须释放 parser/listener 状态。
          terminal.dispose();
        }
      }, error => {
        terminal.dispose();
        throw error;
      });
      return finalization;
    },
  };
  return Object.freeze(session);
}
