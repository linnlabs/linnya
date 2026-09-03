import type {
  PtyCommandAgentTextProjection,
  PtyTerminalScreenProjection,
} from '../../../../../domains/commands';
import type { CommandTextProjectionLimits } from '../../output';

export interface PtyScreenProjectionOptions {
  readonly columns: number;
  readonly rows: number;
  readonly scrollbackLines: number;
  readonly agentTextProjectionLimits: CommandTextProjectionLimits;
}

export interface PtyScreenProjectionSnapshot {
  readonly screen: PtyTerminalScreenProjection;
  readonly agentText: PtyCommandAgentTextProjection;
  /** 只包含 headless 活动 buffer 的稳定纯文本；不包含控制序列或宿主副作用。 */
  readonly stableText: string;
}

export interface PtyScreenProjectionFinalization extends PtyScreenProjectionSnapshot {
  readonly sourceCompletion: 'complete' | 'interrupted';
}

export interface PtyScreenProjectionSession {
  /** 输入是 PTY backend transcript，不是 child stdout 原始 byte。 */
  write(transcriptBytes: Uint8Array): Promise<void>;
  resize(columns: number, rows: number): Promise<void>;
  snapshot(): Promise<PtyScreenProjectionSnapshot>;
  /** terminal settlement 的唯一关闭入口；等待所有已接纳 parser 工作后再释放 headless 实例。 */
  finalize(
    sourceCompletion: 'complete' | 'interrupted',
  ): Promise<PtyScreenProjectionFinalization>;
}
