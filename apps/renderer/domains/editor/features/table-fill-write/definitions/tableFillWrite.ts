import type { TableCellWriteEditor } from '../../../blocks/TableBlock/ai/tableCellWriter.js';

export type TableFillWriteMode = 'replace' | 'append';

export interface TableFillWriteCommand {
  sessionId: string;
  unitId: string;
  content: string;
  mode: TableFillWriteMode;
}

/** 跨 domain 只允许通过稳定 session/unit 身份提交写入，不暴露 Editor 或表格坐标。 */
export interface TableFillWritePort {
  enqueueWrite(command: TableFillWriteCommand): Promise<void>;
  flush(sessionId: string): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  endSession(sessionId: string): Promise<void>;
}

export interface TableFillWriteUnitTarget {
  unitId: string;
  rowIndex: number;
  colIndex: number;
  rowContext?: Readonly<Record<string, unknown>>;
}

/**
 * Editor 内部的 session 启动参数。
 *
 * 这些 PM 能力和坐标只允许停留在 Editor domain，不能进入跨域 port command。
 */
export interface BeginTableFillWriteSessionInput {
  sessionId: string;
  editor: TableCellWriteEditor;
  table: {
    initialPos: number;
    rootBlockId: string;
  };
  units: readonly TableFillWriteUnitTarget[];
  signal?: AbortSignal;
}

export interface TableFillWriteSessionOwner {
  beginSession(input: BeginTableFillWriteSessionInput): void;
}

export interface TableFillWriteRuntime {
  port: TableFillWritePort;
  sessions: TableFillWriteSessionOwner;
}

export interface TableFillInputReference {
  refKey: string;
  label: string;
  rect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

export interface BuildTableFillRowPlansInput {
  editor: TableCellWriteEditor;
  table: {
    initialPos: number;
    rootBlockId: string;
  };
  outputRect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  activeInputRefs: readonly TableFillInputReference[];
  promptTemplate: string;
}

export interface TableFillRowPlan {
  rowIndex: number;
  colIndex: number;
  prompt: string;
  rowContext: Readonly<Record<string, string>>;
}

export interface BuiltTableFillRowPlans {
  table: {
    initialPos: number;
    rootBlockId: string;
  };
  rows: readonly TableFillRowPlan[];
}
