import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
  AppServerRpcPeer,
} from 'src/app-hosts/linnya/app-server-rpc';
import type { CommandApprovalRendererGatewayPort } from '../../approval-host';
import type { CommandCardRendererGatewayPort } from '../../command-card-control-host';
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
  DESKTOP_COMMAND_APPROVAL_CHANGED_RPC_METHOD,
  DESKTOP_COMMAND_CARD_CHANGED_RPC_METHOD,
} from '../definitions/commandRendererRpc';
import {
  CommandApprovalPageRpcResponseSchema,
  CommandApprovalReplyRpcResponseSchema,
  CommandCardCancelRpcResponseSchema,
  CommandCardPageRpcResponseSchema,
  CommandChangedRpcPayloadSchema,
  CommandPermissionSettingsReadRpcResponseSchema,
  CommandPermissionSettingsUpdateRpcResponseSchema,
  CommandProtectedInputRpcResponseSchema,
  CommandVoidRpcResponseSchema,
} from '../functions/commandRendererRpcCodec';

export interface CommandDesktopRpcGateways {
  readonly permissionSettings: CommandPermissionSettingsRendererGatewayPort;
  readonly approval: CommandApprovalRendererGatewayPort;
  readonly card: CommandCardRendererGatewayPort;
  readonly notificationHandlers: AppServerRpcHandlerRegistry;
}

/** Desktop Main 取得三个窄 gateway；raw RPC 不进入 Electron IPC handler。 */
export function createCommandDesktopRpcGateways(input: {
  readonly rpc: Pick<AppServerRpcPeer, 'request'>;
  readonly onAsyncFailure: (error: Error) => void;
}): CommandDesktopRpcGateways {
  const approvalListeners = new Set<() => void>();
  const cardListeners = new Set<() => void>();

  const publish = (listeners: ReadonlySet<() => void>): void => {
    for (const listener of listeners) listener();
  };
  const notificationHandlers = new Map<string, AppServerRpcHandler>([
    [DESKTOP_COMMAND_APPROVAL_CHANGED_RPC_METHOD, payload => {
      CommandChangedRpcPayloadSchema.parse(payload);
      publish(approvalListeners);
      return null;
    }],
    [DESKTOP_COMMAND_CARD_CHANGED_RPC_METHOD, payload => {
      CommandChangedRpcPayloadSchema.parse(payload);
      publish(cardListeners);
      return null;
    }],
  ]);

  const approval: CommandApprovalRendererGatewayPort = {
    async openRendererPage(ownerId) {
      const response = await input.rpc.request(
        BACKEND_COMMAND_APPROVAL_PAGE_OPEN_RPC_METHOD,
        { owner_id: ownerId },
      );
      return CommandApprovalPageRpcResponseSchema.parse(response) ?? undefined;
    },
    async readRendererPage(request) {
      const response = await input.rpc.request(
        BACKEND_COMMAND_APPROVAL_PAGE_READ_RPC_METHOD,
        { owner_id: request.ownerId, page_ticket: request.pageTicket },
      );
      return CommandApprovalPageRpcResponseSchema.parse(response) ?? undefined;
    },
    invalidateRendererPage(request) {
      void input.rpc.request(BACKEND_COMMAND_APPROVAL_PAGE_INVALIDATE_RPC_METHOD, {
        owner_id: request.ownerId,
        page_ticket: request.pageTicket,
      }).then(CommandVoidRpcResponseSchema.parse).catch((error: unknown) => {
        input.onAsyncFailure(toError(error));
      });
    },
    async submitRendererReply(request) {
      const response = await input.rpc.request(
        BACKEND_COMMAND_APPROVAL_REPLY_RPC_METHOD,
        { owner_id: request.ownerId, submission: request.submission },
      );
      return CommandApprovalReplyRpcResponseSchema.parse(response);
    },
    subscribe(listener) {
      approvalListeners.add(listener);
      return () => approvalListeners.delete(listener);
    },
  };

  const card: CommandCardRendererGatewayPort = {
    async openRendererPage(ownerId, conversationId) {
      const response = await input.rpc.request(BACKEND_COMMAND_CARD_PAGE_OPEN_RPC_METHOD, {
        owner_id: ownerId,
        conversation_id: conversationId,
      });
      return CommandCardPageRpcResponseSchema.parse(response) ?? undefined;
    },
    async readRendererPage(request) {
      const response = await input.rpc.request(BACKEND_COMMAND_CARD_PAGE_READ_RPC_METHOD, {
        owner_id: request.ownerId,
        page_ticket: request.pageTicket,
      });
      return CommandCardPageRpcResponseSchema.parse(response) ?? undefined;
    },
    invalidateRendererPage(request) {
      void input.rpc.request(BACKEND_COMMAND_CARD_PAGE_INVALIDATE_RPC_METHOD, {
        owner_id: request.ownerId,
        page_ticket: request.pageTicket,
      }).then(CommandVoidRpcResponseSchema.parse).catch((error: unknown) => {
        input.onAsyncFailure(toError(error));
      });
    },
    async cancel(request) {
      const response = await input.rpc.request(BACKEND_COMMAND_CARD_CANCEL_RPC_METHOD, {
        owner_id: request.ownerId,
        submission: request.submission,
      });
      return CommandCardCancelRpcResponseSchema.parse(response);
    },
    async submitProtectedInput(request) {
      const response = await input.rpc.request(BACKEND_COMMAND_PROTECTED_INPUT_RPC_METHOD, {
        owner_id: request.ownerId,
        submission: request.submission,
      });
      return CommandProtectedInputRpcResponseSchema.parse(response);
    },
    subscribe(listener) {
      cardListeners.add(listener);
      return () => cardListeners.delete(listener);
    },
  };

  const permissionSettings: CommandPermissionSettingsRendererGatewayPort = {
    async read() {
      const response = await input.rpc.request(
        BACKEND_COMMAND_PERMISSION_SETTINGS_READ_RPC_METHOD,
        null,
      );
      return CommandPermissionSettingsReadRpcResponseSchema.parse(response);
    },
    async update(update) {
      const response = await input.rpc.request(
        BACKEND_COMMAND_PERMISSION_SETTINGS_UPDATE_RPC_METHOD,
        { update },
      );
      return CommandPermissionSettingsUpdateRpcResponseSchema.parse(response);
    },
  };

  return Object.freeze({
    approval: Object.freeze(approval),
    card: Object.freeze(card),
    permissionSettings: Object.freeze(permissionSettings),
    notificationHandlers,
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
