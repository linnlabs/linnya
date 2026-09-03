import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from 'src/app-hosts/linnya/app-server-rpc';
import { JsonValueSchema } from '@app/schemas';
import type { CommandApprovalRendererPagePort } from '../../approval-host';
import type { CommandCardRendererControlPort } from '../../command-card-control-host';
import type { CommandPermissionSettingsRendererGatewayPort } from '../../permission-settings-authority';
import {
  BACKEND_COMMAND_APPROVAL_PAGE_INVALIDATE_RPC_METHOD,
  BACKEND_COMMAND_APPROVAL_PAGE_OPEN_RPC_METHOD,
  BACKEND_COMMAND_APPROVAL_PAGE_READ_RPC_METHOD,
  BACKEND_COMMAND_APPROVAL_REPLY_RPC_METHOD,
  BACKEND_COMMAND_CARD_CANCEL_RPC_METHOD,
  BACKEND_COMMAND_CARD_PAGE_INVALIDATE_RPC_METHOD,
  BACKEND_COMMAND_CARD_PAGE_OPEN_RPC_METHOD,
  BACKEND_COMMAND_CARD_PAGE_READ_RPC_METHOD,
  BACKEND_COMMAND_PERMISSION_SETTINGS_READ_RPC_METHOD,
  BACKEND_COMMAND_PERMISSION_SETTINGS_UPDATE_RPC_METHOD,
  BACKEND_COMMAND_PROTECTED_INPUT_RPC_METHOD,
} from '../definitions/commandRendererRpc';
import {
  CommandApprovalPageInvalidateRpcRequestSchema,
  CommandApprovalPageOpenRpcRequestSchema,
  CommandApprovalPageReadRpcRequestSchema,
  CommandApprovalReplyRpcRequestSchema,
  CommandCardCancelRpcRequestSchema,
  CommandCardPageInvalidateRpcRequestSchema,
  CommandCardPageOpenRpcRequestSchema,
  CommandCardPageReadRpcRequestSchema,
  CommandPermissionSettingsUpdateRpcRequestSchema,
  CommandProtectedInputRpcRequestSchema,
} from '../functions/commandRendererRpcCodec';

/** Main→App Server 只暴露现有设置、审批与卡片页面动作，不暴露完整 command owner。 */
export function createCommandBackendRpcHandlers(input: {
  readonly permissionSettings: CommandPermissionSettingsRendererGatewayPort;
  readonly approval: CommandApprovalRendererPagePort;
  readonly card: CommandCardRendererControlPort;
}): AppServerRpcHandlerRegistry {
  return new Map<string, AppServerRpcHandler>([
    [BACKEND_COMMAND_PERMISSION_SETTINGS_READ_RPC_METHOD, async () => (
      input.permissionSettings.read()
    )],
    [BACKEND_COMMAND_PERMISSION_SETTINGS_UPDATE_RPC_METHOD, async payload => {
      const request = CommandPermissionSettingsUpdateRpcRequestSchema.parse(payload);
      return input.permissionSettings.update(request.update);
    }],
    [BACKEND_COMMAND_APPROVAL_PAGE_OPEN_RPC_METHOD, payload => {
      const request = CommandApprovalPageOpenRpcRequestSchema.parse(payload);
      return input.approval.openRendererPage(request.owner_id) ?? null;
    }],
    [BACKEND_COMMAND_APPROVAL_PAGE_READ_RPC_METHOD, payload => {
      const request = CommandApprovalPageReadRpcRequestSchema.parse(payload);
      return input.approval.readRendererPage({
        ownerId: request.owner_id,
        pageTicket: request.page_ticket,
      }) ?? null;
    }],
    [BACKEND_COMMAND_APPROVAL_PAGE_INVALIDATE_RPC_METHOD, payload => {
      const request = CommandApprovalPageInvalidateRpcRequestSchema.parse(payload);
      input.approval.invalidateRendererPage({
        ownerId: request.owner_id,
        pageTicket: request.page_ticket,
      });
      return null;
    }],
    [BACKEND_COMMAND_APPROVAL_REPLY_RPC_METHOD, payload => {
      const request = CommandApprovalReplyRpcRequestSchema.parse(payload);
      return input.approval.submitRendererReply({
        ownerId: request.owner_id,
        submission: request.submission,
      });
    }],
    [BACKEND_COMMAND_CARD_PAGE_OPEN_RPC_METHOD, async payload => {
      const request = CommandCardPageOpenRpcRequestSchema.parse(payload);
      return JsonValueSchema.parse(
        await input.card.openRendererPage(
          request.owner_id,
          request.conversation_id,
        ) ?? null,
      );
    }],
    [BACKEND_COMMAND_CARD_PAGE_READ_RPC_METHOD, async payload => {
      const request = CommandCardPageReadRpcRequestSchema.parse(payload);
      return JsonValueSchema.parse(
        await input.card.readRendererPage({
          ownerId: request.owner_id,
          pageTicket: request.page_ticket,
        }) ?? null,
      );
    }],
    [BACKEND_COMMAND_CARD_PAGE_INVALIDATE_RPC_METHOD, payload => {
      const request = CommandCardPageInvalidateRpcRequestSchema.parse(payload);
      input.card.invalidateRendererPage({
        ownerId: request.owner_id,
        pageTicket: request.page_ticket,
      });
      return null;
    }],
    [BACKEND_COMMAND_CARD_CANCEL_RPC_METHOD, async payload => {
      const request = CommandCardCancelRpcRequestSchema.parse(payload);
      return input.card.cancel({
        ownerId: request.owner_id,
        submission: request.submission,
      });
    }],
    [BACKEND_COMMAND_PROTECTED_INPUT_RPC_METHOD, async payload => {
      const request = CommandProtectedInputRpcRequestSchema.parse(payload);
      return input.card.submitProtectedInput({
        ownerId: request.owner_id,
        submission: request.submission,
      });
    }],
  ]);
}
