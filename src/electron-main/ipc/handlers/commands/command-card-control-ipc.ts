import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  COMMAND_CARD_CANCEL_CHANNEL,
  COMMAND_CARD_CONTROL_CHANGED_CHANNEL,
  COMMAND_CARD_CONTROL_PAGE_CLOSE_CHANNEL,
  COMMAND_CARD_CONTROL_PAGE_OPEN_CHANNEL,
  CommandCardCancelResultV1Schema,
  CommandCardCancelSubmissionV1Schema,
  CommandCardControlChangedEventV1Schema,
  CommandCardControlPageCloseRequestV1Schema,
  CommandCardControlPageCloseResultV1Schema,
  CommandCardControlPageOpenRequestV1Schema,
  CommandCardControlPageOpenResultV1Schema,
  type CommandCardControlPageTicket,
} from '@app/schemas/commands';
import type { CommandCardRendererGatewayPort } from 'src/app-hosts/linnya/adapters/commands/command-card-control-host';
import { Logger } from '../../../../shared/logger.js';

export function registerCommandCardControlHandlers(input: {
  readonly host: CommandCardRendererGatewayPort;
  readonly logger?: Pick<Logger, 'error'>;
}): void {
  const { host } = input;
  const logger = input.logger ?? new Logger('CommandCardControlIPC');
  interface RendererOwner {
    readonly sender: WebContents;
    readonly pageTicket: CommandCardControlPageTicket;
    readonly cleanupListeners: () => void;
  }
  const rendererOwners = new Map<number, RendererOwner>();
  const projectionTails = new Map<number, Promise<void>>();
  const openGenerations = new Map<number, number>();

  const advanceOpenGeneration = (ownerId: number): number => {
    const next = (openGenerations.get(ownerId) ?? 0) + 1;
    openGenerations.set(ownerId, next);
    return next;
  };

  const scheduleProjection = (ownerId: number): void => {
    const scheduledPage = rendererOwners.get(ownerId);
    if (!scheduledPage) return;
    const previous = projectionTails.get(ownerId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const page = rendererOwners.get(ownerId);
      if (page !== scheduledPage || page.sender.isDestroyed()) return;
      const snapshot = await host.readRendererPage({ ownerId, pageTicket: page.pageTicket });
      const current = rendererOwners.get(ownerId);
      if (
        !snapshot
        || current !== page
        || current.pageTicket !== snapshot.page_ticket
        || page.sender.isDestroyed()
      ) return;
      page.sender.send(
        COMMAND_CARD_CONTROL_CHANGED_CHANNEL,
        CommandCardControlChangedEventV1Schema.parse({
          protocol_version: 1,
          kind: 'command_card_control_changed',
          snapshot,
        }),
      );
    }).catch((error: unknown) => {
      const page = rendererOwners.get(ownerId);
      if (page !== scheduledPage) return;
      logger.error('命令卡片控制状态投影失败，已撤销对应 renderer 页面', {
        ownerId,
        pageTicket: page.pageTicket,
        error,
      });
      scheduledPage.cleanupListeners();
      host.invalidateRendererPage({ ownerId, pageTicket: scheduledPage.pageTicket });
      rendererOwners.delete(ownerId);
    }).finally(() => {
      if (projectionTails.get(ownerId) === next) projectionTails.delete(ownerId);
    });
    projectionTails.set(ownerId, next);
  };

  host.subscribe(() => {
    for (const [ownerId, page] of rendererOwners) {
      if (page.sender.isDestroyed()) {
        page.cleanupListeners();
        advanceOpenGeneration(ownerId);
        host.invalidateRendererPage({ ownerId, pageTicket: page.pageTicket });
        rendererOwners.delete(ownerId);
        continue;
      }
      scheduleProjection(ownerId);
    }
  });

  ipcMain.handle(COMMAND_CARD_CONTROL_PAGE_OPEN_CHANNEL, async (event: IpcMainInvokeEvent, raw: unknown) => {
    const request = CommandCardControlPageOpenRequestV1Schema.safeParse(raw);
    if (!request.success) {
      return CommandCardControlPageOpenResultV1Schema.parse({ success: false, code: 'owner_unavailable' });
    }
    const ownerId = event.sender.id;
    const openGeneration = advanceOpenGeneration(ownerId);
    const snapshot = await host.openRendererPage(ownerId, request.data.conversation_id);
    if (!snapshot) {
      return CommandCardControlPageOpenResultV1Schema.parse({ success: false, code: 'owner_unavailable' });
    }
    if (openGenerations.get(ownerId) !== openGeneration) {
      // 迟到 open 不能清理或覆盖新页面；host 会按 page ticket 忽略对现页的撤销。
      host.invalidateRendererPage({ ownerId, pageTicket: snapshot.page_ticket });
      return CommandCardControlPageOpenResultV1Schema.parse({ success: true, snapshot });
    }
    const previous = rendererOwners.get(ownerId);
    if (previous) {
      previous.cleanupListeners();
      host.invalidateRendererPage({ ownerId, pageTicket: previous.pageTicket });
    }
    let cleanupListeners = (): void => {};
    const closePage = (): void => {
      cleanupListeners();
      if (rendererOwners.get(ownerId)?.pageTicket === snapshot.page_ticket) {
        advanceOpenGeneration(ownerId);
      }
      host.invalidateRendererPage({ ownerId, pageTicket: snapshot.page_ticket });
      if (rendererOwners.get(ownerId)?.pageTicket === snapshot.page_ticket) {
        rendererOwners.delete(ownerId);
      }
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
      pageTicket: snapshot.page_ticket,
      cleanupListeners,
    });
    return CommandCardControlPageOpenResultV1Schema.parse({ success: true, snapshot });
  });

  ipcMain.handle(COMMAND_CARD_CANCEL_CHANNEL, async (event: IpcMainInvokeEvent, raw: unknown) => {
    const submission = CommandCardCancelSubmissionV1Schema.safeParse(raw);
    if (!submission.success) return CommandCardCancelResultV1Schema.parse({ status: 'stale' });
    return CommandCardCancelResultV1Schema.parse(await host.cancel({
      ownerId: event.sender.id,
      submission: submission.data,
    }));
  });

  ipcMain.handle(COMMAND_CARD_CONTROL_PAGE_CLOSE_CHANNEL, async (
    event: IpcMainInvokeEvent,
    raw: unknown,
  ) => {
    const request = CommandCardControlPageCloseRequestV1Schema.safeParse(raw);
    if (!request.success) {
      return CommandCardControlPageCloseResultV1Schema.parse({ status: 'stale' });
    }
    const ownerId = event.sender.id;
    const page = rendererOwners.get(ownerId);
    if (!page || page.pageTicket !== request.data.page_ticket) {
      return CommandCardControlPageCloseResultV1Schema.parse({ status: 'stale' });
    }
    page.cleanupListeners();
    advanceOpenGeneration(ownerId);
    host.invalidateRendererPage({ ownerId, pageTicket: page.pageTicket });
    rendererOwners.delete(ownerId);
    return CommandCardControlPageCloseResultV1Schema.parse({ status: 'closed' });
  });
}
