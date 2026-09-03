import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  COMMAND_APPROVAL_CHANGED_CHANNEL,
  COMMAND_APPROVAL_PAGE_OPEN_CHANNEL,
  COMMAND_APPROVAL_REPLY_CHANNEL,
  CommandApprovalChangedEventV1Schema,
  CommandApprovalPageOpenResultV1Schema,
  CommandApprovalReplyResultV1Schema,
  CommandApprovalReplySubmissionV1Schema,
  type CommandApprovalPageTicket,
} from '@app/schemas/commands';
import type { CommandApprovalRendererGatewayPort } from 'src/app-hosts/linnya/adapters/commands/approval-host';

interface CommandApprovalRendererPage {
  readonly sender: WebContents;
  readonly pageTicket: CommandApprovalPageTicket;
  readonly cleanupListeners: () => void;
}

export function registerCommandApprovalHandlers(input: {
  readonly host: CommandApprovalRendererGatewayPort;
}): void {
  const { host } = input;
  const rendererOwners = new Map<number, CommandApprovalRendererPage>();
  const projectionTails = new Map<number, Promise<void>>();

  const closeRendererPage = (
    ownerId: number,
    page: CommandApprovalRendererPage,
  ): void => {
    page.cleanupListeners();
    host.invalidateRendererPage({ ownerId, pageTicket: page.pageTicket });
    if (rendererOwners.get(ownerId)?.pageTicket === page.pageTicket) {
      rendererOwners.delete(ownerId);
    }
  };

  const scheduleProjection = (ownerId: number): void => {
    const scheduledPage = rendererOwners.get(ownerId);
    if (!scheduledPage) return;
    const previous = projectionTails.get(ownerId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const page = rendererOwners.get(ownerId);
      if (page !== scheduledPage || page.sender.isDestroyed()) return;
      const snapshot = await host.readRendererPage({
        ownerId,
        pageTicket: page.pageTicket,
      });
      if (!snapshot || rendererOwners.get(ownerId) !== page || page.sender.isDestroyed()) {
        closeRendererPage(ownerId, page);
        return;
      }
      page.sender.send(
        COMMAND_APPROVAL_CHANGED_CHANNEL,
        CommandApprovalChangedEventV1Schema.parse({
          protocol_version: 1,
          kind: 'command_approval_changed',
          snapshot,
        }),
      );
    }).catch(() => {
      // 页面发送或 App Server RPC 失败后，旧 ticket 已不再拥有可信 owner。
      const page = rendererOwners.get(ownerId);
      if (page === scheduledPage) closeRendererPage(ownerId, page);
    }).finally(() => {
      if (projectionTails.get(ownerId) === next) projectionTails.delete(ownerId);
    });
    projectionTails.set(ownerId, next);
  };

  host.subscribe(() => {
    for (const [ownerId, page] of rendererOwners) {
      if (page.sender.isDestroyed()) closeRendererPage(ownerId, page);
      else scheduleProjection(ownerId);
    }
  });

  ipcMain.handle(
    COMMAND_APPROVAL_PAGE_OPEN_CHANNEL,
    async (event: IpcMainInvokeEvent) => {
      const ownerId = event.sender.id;
      const snapshot = await host.openRendererPage(ownerId);
      if (!snapshot) {
        return CommandApprovalPageOpenResultV1Schema.parse({
          success: false,
          code: 'owner_unavailable',
        });
      }

      const pageTicket = snapshot.page_ticket;
      const previous = rendererOwners.get(ownerId);
      if (previous) closeRendererPage(ownerId, previous);
      let cleanupListeners = (): void => {};
      const closePage = (): void => {
        const page = rendererOwners.get(ownerId);
        if (!page || page.pageTicket !== pageTicket) return;
        closeRendererPage(ownerId, page);
      };
      event.sender.once('did-start-navigation', closePage);
      event.sender.once('render-process-gone', closePage);
      event.sender.once('destroyed', closePage);
      cleanupListeners = (): void => {
        event.sender.removeListener('did-start-navigation', closePage);
        event.sender.removeListener('render-process-gone', closePage);
        event.sender.removeListener('destroyed', closePage);
      };
      rendererOwners.set(ownerId, {
        sender: event.sender,
        pageTicket,
        cleanupListeners,
      });

      return CommandApprovalPageOpenResultV1Schema.parse({ success: true, snapshot });
    },
  );

  ipcMain.handle(
    COMMAND_APPROVAL_REPLY_CHANNEL,
    async (event: IpcMainInvokeEvent, raw: unknown) => {
      const parsed = CommandApprovalReplySubmissionV1Schema.safeParse(raw);
      if (!parsed.success) {
        return CommandApprovalReplyResultV1Schema.parse({
          success: true,
          status: 'stale',
        });
      }
      return CommandApprovalReplyResultV1Schema.parse(await host.submitRendererReply({
        ownerId: event.sender.id,
        submission: parsed.data,
      }));
    },
  );
}
