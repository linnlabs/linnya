/**
 * Agent 只消费稳定纯文本预览，不消费原始 byte、终端控制序列或文件路径。
 * stdout/stderr 分开表达，避免把两个操作系统 pipe 的到达顺序冒充为绝对顺序。
 * `*_chars` 统一使用 JavaScript UTF-16 索引单位，与现有 ToolOutputStore cursor 保持一致。
 * 行数按稳定文本中的换行符计算：空文本为 0，其他文本为换行符数量加 1，尾随换行
 * 因此会留下一个真实空行。
 */
export type CommandOutputTextPreview =
  | {
      readonly status: 'complete';
      readonly text: string;
      readonly total_chars: number;
      readonly total_lines: number;
    }
  | {
      readonly status: 'truncated';
      readonly head: string;
      readonly tail: string;
      readonly omitted_chars: number;
      readonly total_chars: number;
      readonly total_lines: number;
    };

export interface PipeCommandAgentTextProjection {
  readonly mode: 'pipe';
  readonly stdout: CommandOutputTextPreview;
  readonly stderr: CommandOutputTextPreview;
}

/** PTY 的 Agent 文本来自受控终端屏幕，不是把 backend transcript 去掉 ESC 后冒充普通 stdout。 */
export interface PtyCommandAgentTextProjection {
  readonly mode: 'pty';
  readonly terminal: CommandOutputTextPreview;
}

export type {
  PtyTerminalCellMetric,
  PtyTerminalCellStyle,
  PtyTerminalColor,
  PtyTerminalScreenLine,
  PtyTerminalScreenProjection,
  PtyTerminalStyleRun,
} from '@app/schemas/commands';

export interface CommandOutputCurrentLogicalLineSnapshot {
  /** 仅供运行中查询；后续 bare CR 可以替换它，不能追加到持久正文。 */
  readonly text: string;
  readonly omittedCharacters: number;
}
