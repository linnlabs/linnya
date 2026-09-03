import type {
  CommandExecutionMode,
  ProcessInteractionRejectionCode,
} from '@app/schemas/commands';

export type CommandExecutionInteractionSettlement = void | {
  readonly status: 'rejected';
  readonly code: ProcessInteractionRejectionCode;
};

/**
 * runtime 必须明确声明输入能力。普通 pipe 从启动起关闭 stdin，不能用可选字段让调用方
 * 猜测；只有显式 PTY runtime 才能提供运行中的输入与 resize。PTY adapter 还必须保证
 * terminal、cancel、owner end 或底层句柄关闭会真实结算全部在途方法，owner 不会用
 * Promise.race 返回伪完成并把仍可能触碰原生句柄的操作留在后台。
 */
export type CommandExecutionInteractionCapability =
  | { readonly kind: 'closed' }
  | {
      readonly kind: 'pty';
      write(input: string): Promise<CommandExecutionInteractionSettlement>;
      submit(input: string): Promise<CommandExecutionInteractionSettlement>;
      eof(): Promise<CommandExecutionInteractionSettlement>;
      resize(size: {
        readonly columns: number;
        readonly rows: number;
      }): Promise<CommandExecutionInteractionSettlement>;
    };

export const CLOSED_COMMAND_EXECUTION_INTERACTION = Object.freeze({
  kind: 'closed',
} as const satisfies CommandExecutionInteractionCapability);

export function doesInteractionCapabilityMatchExecutionMode(
  mode: CommandExecutionMode,
  capability: CommandExecutionInteractionCapability,
): boolean {
  return mode === 'pty' ? capability.kind === 'pty' : capability.kind === 'closed';
}
