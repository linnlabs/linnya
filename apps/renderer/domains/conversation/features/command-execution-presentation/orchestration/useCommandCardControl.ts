import {
  CommandCardCancelSubmissionV1Schema,
  CommandProtectedInputSubmissionV1Schema,
  type CommandProtectedInputResultV1,
  type CommandProcessHandle,
} from '@app/schemas/commands';
import {
  commandCardControlGateway,
  type CommandCardControlGateway,
} from '../infrastructure/commandCardControlGateway';
import { useCommandCardControlStore } from '../store/commandCardControlStore';

let mountedConversationId: string | undefined;
let opening: Promise<void> | undefined;
let unsubscribe = () => {};
let pageGeneration = 0;
let mountedGateway: CommandCardControlGateway = commandCardControlGateway;
let mountedOwner: symbol | undefined;

export interface CommandCardControlPageOwner {
  ensure(conversationId: string): Promise<void>;
  release(): void;
}

async function openAndReplace(
  conversationId: string,
  gateway: CommandCardControlGateway,
  generation: number,
): Promise<void> {
  const store = useCommandCardControlStore();
  try {
    const result = await gateway.openPage(conversationId);
    if (mountedConversationId !== conversationId || pageGeneration !== generation) {
      // release 可能发生在 open 返回前。迟到成功结果已经在 main 创建了页面，必须用
      // 它自己的 ticket 精确撤销；main 的 ticket 校验会保护后来打开的新页面。
      if (result.success) {
        await gateway.closePage(result.snapshot.page_ticket).catch(() => undefined);
      }
      return;
    }
    if (result.success) store.replaceSnapshot(result.snapshot);
    else store.markPageUnavailable();
  } catch {
    if (mountedConversationId === conversationId && pageGeneration === generation) {
      store.markPageUnavailable();
    }
  }
}

async function ensureCommandCardControlPage(
  conversationId: string,
  gateway: CommandCardControlGateway,
  owner: symbol,
): Promise<void> {
  const store = useCommandCardControlStore();
  mountedOwner = owner;
  if (mountedConversationId === conversationId && store.snapshot) return;
  if (mountedConversationId === conversationId && opening) return opening;

  if (mountedConversationId !== conversationId) {
    // 控制能力严格属于当前对话页；新页 open 尚未返回时也不能继续展示旧页事实。
    store.reset();
  }
  mountedConversationId = conversationId;
  mountedGateway = gateway;
  const generation = ++pageGeneration;
  unsubscribe();
  unsubscribe = gateway.subscribe((event) => {
    if (
      event.snapshot.conversation_id === mountedConversationId
      && event.snapshot.page_ticket === store.snapshot?.page_ticket
    ) store.replaceSnapshot(event.snapshot);
  });
  const currentConversationId = conversationId;
  opening = openAndReplace(conversationId, gateway, generation).finally(() => {
    if (mountedConversationId === currentConversationId && pageGeneration === generation) {
      opening = undefined;
    }
  });
  return opening;
}

export async function submitProtectedInputFromCurrentCard(
  processHandle: CommandProcessHandle,
  input: string,
  gateway: CommandCardControlGateway = commandCardControlGateway,
): Promise<CommandProtectedInputResultV1> {
  const store = useCommandCardControlStore();
  const snapshot = store.snapshot;
  const capability = snapshot?.capabilities.find(value => (
    value.process_handle === processHandle && value.protected_input_ticket
  ));
  if (!snapshot || !capability?.protected_input_ticket) return { status: 'stale' };
  const submittedPageTicket = snapshot.page_ticket;
  try {
    const result = await gateway.submitProtectedInput(CommandProtectedInputSubmissionV1Schema.parse({
      page_ticket: submittedPageTicket,
      protected_input_ticket: capability.protected_input_ticket,
      input,
    }));
    if (store.snapshot?.page_ticket !== submittedPageTicket) return { status: 'stale' };
    if (result.status === 'failed' && result.code === 'owner_unavailable') {
      store.markPageUnavailable();
    }
    return result;
  } catch {
    // 保护输入绝不自动重试；调用方清空局部值并让用户决定是否重新输入。
    return { status: 'failed', code: 'owner_unavailable' };
  }
}

export async function cancelCommandFromCurrentCard(
  processHandle: CommandProcessHandle,
  gateway: CommandCardControlGateway = commandCardControlGateway,
): Promise<void> {
  const store = useCommandCardControlStore();
  const snapshot = store.snapshot;
  const capability = snapshot?.capabilities.find(value => value.process_handle === processHandle);
  if (!snapshot || !capability || store.cancellingHandle === processHandle) return;
  store.cancelStarted(processHandle);
  const submittedPageTicket = snapshot.page_ticket;
  try {
    const result = await gateway.cancel(CommandCardCancelSubmissionV1Schema.parse({
      page_ticket: snapshot.page_ticket,
      control_ticket: capability.control_ticket,
    }));
    if (store.snapshot?.page_ticket !== submittedPageTicket) return;
    if (result.status === 'settled') {
      const currentSnapshot = store.snapshot;
      if (!currentSnapshot || currentSnapshot.page_ticket !== submittedPageTicket) return;
      // 取消等待期间，同页可能已经收到其他 execution 的终态或新 capability。
      // 必须在当前快照上合并本次终态，不能让点击时捕获的旧快照覆盖较新的事实。
      store.replaceSnapshot({
        ...currentSnapshot,
        capabilities: currentSnapshot.capabilities.filter(
          value => value.process_handle !== processHandle,
        ),
        settlements: [
          ...currentSnapshot.settlements.filter(value => value.process_handle !== processHandle),
          result.settlement,
        ],
        settlement_failures: currentSnapshot.settlement_failures.filter(
          value => value !== processHandle,
        ),
      });
      store.cancelFinished(processHandle, false);
      return;
    }
    if (result.status === 'stale') {
      store.reset();
      if (mountedConversationId) {
        const generation = ++pageGeneration;
        await openAndReplace(mountedConversationId, gateway, generation);
      }
      return;
    }
    if (result.code === 'owner_unavailable') {
      store.markPageUnavailable();
      return;
    }
    store.cancelFinished(processHandle, true);
  } catch {
    if (store.snapshot?.page_ticket === submittedPageTicket) {
      store.cancelFinished(processHandle, true);
    }
  }
}

function releaseCommandCardControlPage(owner: symbol): void {
  if (mountedOwner !== owner) return;
  const pageTicket = useCommandCardControlStore().snapshot?.page_ticket;
  const gateway = mountedGateway;
  pageGeneration += 1;
  mountedConversationId = undefined;
  opening = undefined;
  unsubscribe();
  unsubscribe = () => {};
  useCommandCardControlStore().reset();
  mountedGateway = commandCardControlGateway;
  mountedOwner = undefined;
  if (pageTicket) void gateway.closePage(pageTicket).catch(() => undefined);
}

/**
 * 控制页属于 ConversationHost，而不是会被虚拟化反复挂卸的命令卡片。
 * owner token 让旧页面只能释放自己持有的那一代，不能误关后来激活的页面。
 */
export function createCommandCardControlPageOwner(
  gateway: CommandCardControlGateway = commandCardControlGateway,
): CommandCardControlPageOwner {
  const owner = Symbol('command-card-control-page-owner');
  return Object.freeze({
    ensure: (conversationId: string) => ensureCommandCardControlPage(conversationId, gateway, owner),
    release: () => releaseCommandCardControlPage(owner),
  });
}
