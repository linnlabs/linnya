import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import {
  COMMAND_PERMISSION_SETTINGS_READ_CHANNEL,
  COMMAND_PERMISSION_SETTINGS_UPDATE_CHANNEL,
  CONVERSATION_COMMAND_PERMISSION_CHANNEL,
  CONVERSATION_COMMAND_PERMISSION_CHANGED_CHANNEL,
  ConversationCommandPermissionRequestSchema,
  ConversationCommandPermissionResultSchema,
  type ConversationCommandPermissionRequest,
  type ConversationCommandPermissionResult,
  CommandPermissionSettingsReadResultV1Schema,
  CommandPermissionSettingsUpdateResultV1Schema,
  CommandPermissionSettingsUpdateV1Schema,
} from '@app/schemas/commands';
import type { CommandPermissionSettingsRendererGatewayPort } from 'src/app-hosts/linnya/adapters/commands/permission-settings-authority';

export interface RegisterCommandPermissionSettingsHandlersOptions {
  readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
  readonly conversationPermission: (request: ConversationCommandPermissionRequest) => Promise<ConversationCommandPermissionResult>;
  readonly gateway: CommandPermissionSettingsRendererGatewayPort;
}

export function registerCommandPermissionSettingsHandlers(
  options: RegisterCommandPermissionSettingsHandlersOptions,
): void {
  const { gateway, isTrustedSender, conversationPermission } = options;

  ipcMain.handle(
    COMMAND_PERMISSION_SETTINGS_READ_CHANNEL,
    async () => {
      return CommandPermissionSettingsReadResultV1Schema.parse(await gateway.read());
    },
  );

  ipcMain.handle(
    COMMAND_PERMISSION_SETTINGS_UPDATE_CHANNEL,
    async (event, rawUpdate: unknown) => {
      if (!isTrustedSender(event)) throw new Error('拒绝非主窗口的命令权限更新');
      const parsed = CommandPermissionSettingsUpdateV1Schema.safeParse(rawUpdate);
      if (!parsed.success) {
        return CommandPermissionSettingsUpdateResultV1Schema.parse({
          success: false,
          code: 'invalid_update',
        });
      }
      const result = CommandPermissionSettingsUpdateResultV1Schema.parse(await gateway.update(parsed.data));
      if (result.success && !event.sender.isDestroyed()) {
        event.sender.send(CONVERSATION_COMMAND_PERMISSION_CHANGED_CHANNEL);
      }
      return result;
    },
  );

  ipcMain.handle(CONVERSATION_COMMAND_PERMISSION_CHANNEL, async (event, payload: unknown) => {
    if (!isTrustedSender(event)) throw new Error('拒绝非主窗口的对话命令权限请求');
    const request = ConversationCommandPermissionRequestSchema.parse(payload);
    const result = ConversationCommandPermissionResultSchema.parse(await conversationPermission(request));
    if ((request.kind === 'set' && result.kind === 'view'
      || result.kind === 'reduced' || result.kind === 'partial') && !event.sender.isDestroyed()) {
      event.sender.send(CONVERSATION_COMMAND_PERMISSION_CHANGED_CHANNEL);
    }
    return result;
  });
}
