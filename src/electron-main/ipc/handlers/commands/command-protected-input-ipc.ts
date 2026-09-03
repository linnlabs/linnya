import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  COMMAND_PROTECTED_INPUT_CHANNEL,
  CommandProtectedInputResultV1Schema,
  CommandProtectedInputSubmissionV1Schema,
} from '@app/schemas/commands';

import type { CommandCardRendererGatewayPort } from 'src/app-hosts/linnya/adapters/commands/command-card-control-host';

/**
 * 保护输入使用独立 IPC，避免普通卡片控制或 Agent process DTO 获得秘密字段。
 * renderer 身份只取 Electron event.sender.id，不接收页面自报 owner。
 */
export function registerCommandProtectedInputHandler(input: {
  readonly host: Pick<CommandCardRendererGatewayPort, 'submitProtectedInput'>;
}): void {
  const { host } = input;
  ipcMain.handle(COMMAND_PROTECTED_INPUT_CHANNEL, async (
    event: IpcMainInvokeEvent,
    raw: unknown,
  ) => {
    const submission = CommandProtectedInputSubmissionV1Schema.safeParse(raw);
    if (!submission.success) return CommandProtectedInputResultV1Schema.parse({ status: 'stale' });
    return CommandProtectedInputResultV1Schema.parse(await host.submitProtectedInput({
      ownerId: event.sender.id,
      submission: submission.data,
    }));
  });
}
