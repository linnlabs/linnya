import {
  type CommandApprovalChoice,
  type CommandApprovalPendingProjectionV1,
} from '@app/schemas/commands';
import type {
  CommandApprovalHostPresenterGatewayPort,
  CommandApprovalHostPresenterSnapshot,
} from '../../adapters/commands/approval-host';
import type { CliRuntimeCommandApprovalPromptPort } from '../definitions/cliRuntimeHost';

export interface CliRuntimeCommandApprovalPresenter {
  start(): Promise<void>;
  dispose(): void;
}

/**
 * 终端 presenter 只消费 Host projection 并提交选择。pending、stale 判断和权限提升
 * 仍由 App Server 内的 command owner 决定，因此终端断线不会制造第二份审批事实。
 */
export function createCliRuntimeCommandApprovalPresenter(input: {
  readonly gateway: CommandApprovalHostPresenterGatewayPort;
  readonly prompt: CliRuntimeCommandApprovalPromptPort;
  readonly reportFailure: (error: Error) => void;
}): CliRuntimeCommandApprovalPresenter {
  let snapshot: CommandApprovalHostPresenterSnapshot | undefined;
  let disposed = false;
  let dirty = false;
  let pumping = false;
  let unsubscribe: (() => void) | null = null;

  const schedule = (): void => {
    if (disposed) return;
    dirty = true;
    if (pumping) return;
    pumping = true;
    void pump().catch((error: unknown) => {
      if (!disposed) input.reportFailure(toError(error));
    }).finally(() => {
      pumping = false;
      if (!disposed && dirty) schedule();
    });
  };

  const submitChoice = async (
    approval: CommandApprovalPendingProjectionV1,
  ): Promise<void> => {
    let choice: CommandApprovalChoice;
    try {
      choice = await input.prompt.requestChoice(approval);
    } catch (error: unknown) {
      input.reportFailure(toError(error));
      // 输入流异常时只拒绝当前可见请求；不能默许命令，也不能让它永久等待。
      choice = 'deny';
    }
    if (disposed) return;
    await input.gateway.submit({
      approvalRequestId: approval.approval_request_id,
      choice,
    });
  };

  const pump = async (): Promise<void> => {
    while (!disposed && dirty) {
      dirty = false;
      const current = await input.gateway.read();
      if (!current) {
        dispose();
        return;
      }
      snapshot = current;
      const approval = current.pending.find(item => item.status === 'awaiting_reply');
      if (approval) {
        await submitChoice(approval);
        dirty = true;
      }
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    dirty = false;
    unsubscribe?.();
    unsubscribe = null;
    snapshot = undefined;
    input.prompt.close();
  };

  return Object.freeze({
    async start() {
      if (disposed) throw new Error('CLI Runtime 命令审批 presenter 已关闭');
      if (snapshot) return;
      unsubscribe = input.gateway.subscribe(schedule);
      snapshot = await input.gateway.read();
      if (!snapshot) {
        dispose();
        throw new Error('App Server 命令审批 Host presenter 不可用');
      }
      schedule();
    },
    dispose,
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
