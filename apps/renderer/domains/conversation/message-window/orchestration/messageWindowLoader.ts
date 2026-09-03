import type { MessageWindowApiPort } from '../definitions/messageWindowApi';
import type { MessageWindowSnapshot } from '../definitions/messageWindow';
import type { UiMessagesWindowDto, UiMessagesWindowReadyDto } from '../definitions/uiMessagesDto';
import { mapUiMessagesWindowDtoToRows } from '../functions/mapUiMessageDto';
import { createMessageWindowSnapshot } from '../functions/windowSnapshot';
import { messageWindowApi, readDefaultMessageWindowLimit } from './messageWindowApi';
import { useMessageWindowStore } from '../store/messageWindowStore';
import type { MessageWindowLoadMode } from '../definitions/messageWindow';
import type { BaseMessage } from '../../types';
import { admitWindowAndLiveMessages } from '../functions/windowLiveMessageAdmission';

type MessageWindowStore = ReturnType<typeof useMessageWindowStore>;

export interface MessageWindowLoaderDeps {
  readonly api?: MessageWindowApiPort;
  readonly store?: MessageWindowStore;
  readonly readLiveMessages: (conversationId: string) => readonly BaseMessage[];
}

export interface LoadMessageWindowOptions {
  readonly limit?: number;
}

export type LoadBeforeResult = 'prepended' | 'replaced' | 'preparing' | 'superseded';
export type LoadAfterResult = 'appended' | 'replaced' | 'preparing' | 'superseded';
export type LoadAroundResult = 'replaced' | 'preparing' | 'superseded';

interface MessageWindowRequestToken {
  readonly conversationId: string;
  readonly generation: number;
  readonly mode: MessageWindowLoadMode;
  readonly store: MessageWindowStore;
}

const requestGenerations = new WeakMap<MessageWindowStore, number>();

function beginWindowRequest(
  store: MessageWindowStore,
  conversationId: string,
  mode: MessageWindowLoadMode,
): MessageWindowRequestToken {
  const generation = (requestGenerations.get(store) ?? 0) + 1;
  requestGenerations.set(store, generation);
  store.startLoading(conversationId, mode);
  return { conversationId, generation, mode, store };
}

function isCurrentWindowRequest(token: MessageWindowRequestToken): boolean {
  return requestGenerations.get(token.store) === token.generation
    && token.store.conversationId === token.conversationId
    && token.store.status === 'loading'
    && token.store.loadingMode === token.mode;
}

export async function loadTail(
  conversationId: string,
  options: LoadMessageWindowOptions,
  deps: MessageWindowLoaderDeps,
): Promise<void> {
  const store = deps.store ?? useMessageWindowStore();
  const api = deps.api ?? messageWindowApi;
  const limit = options.limit ?? readDefaultMessageWindowLimit();
  const request = beginWindowRequest(store, conversationId, 'tail');

  try {
    const dto = await api.readTail(conversationId, limit);
    if (!isCurrentWindowRequest(request)) return;
    applyWindowResponse(dto, store, 'replace', deps.readLiveMessages);
  } catch (error) {
    if (isCurrentWindowRequest(request)) {
      store.setError(conversationId, readErrorMessage(error));
    }
    throw error;
  }
}

export async function loadBefore(
  conversationId: string,
  cursor: number,
  options: LoadMessageWindowOptions,
  deps: MessageWindowLoaderDeps,
): Promise<LoadBeforeResult> {
  const store = deps.store ?? useMessageWindowStore();
  const api = deps.api ?? messageWindowApi;
  const limit = options.limit ?? readDefaultMessageWindowLimit();
  const expectedRevision = store.conversationId === conversationId ? store.revision : null;
  const request = beginWindowRequest(store, conversationId, 'before');

  try {
    const dto = await api.readBefore(conversationId, cursor, limit);
    if (!isCurrentWindowRequest(request)) return 'superseded';
    if (dto.success === false) {
      applyWindowResponse(dto, store, 'prepend', deps.readLiveMessages);
      return 'preparing';
    }
    if (dto.success === true && expectedRevision !== null && dto.revision !== expectedRevision) {
      const tailDto = await api.readTail(conversationId, limit);
      if (!isCurrentWindowRequest(request)) return 'superseded';
      applyWindowResponse(tailDto, store, 'replace', deps.readLiveMessages);
      return 'replaced';
    }
    applyWindowResponse(dto, store, 'prepend', deps.readLiveMessages);
    return 'prepended';
  } catch (error) {
    if (isCurrentWindowRequest(request)) {
      store.setError(conversationId, readErrorMessage(error));
    }
    throw error;
  }
}

export async function loadAfter(
  conversationId: string,
  cursor: number,
  options: LoadMessageWindowOptions,
  deps: MessageWindowLoaderDeps,
): Promise<LoadAfterResult> {
  const store = deps.store ?? useMessageWindowStore();
  const api = deps.api ?? messageWindowApi;
  const limit = options.limit ?? readDefaultMessageWindowLimit();
  const expectedRevision = store.conversationId === conversationId ? store.revision : null;
  const request = beginWindowRequest(store, conversationId, 'after');

  try {
    const dto = await api.readAfter(conversationId, cursor, limit);
    if (!isCurrentWindowRequest(request)) return 'superseded';
    if (dto.success === false) {
      applyWindowResponse(dto, store, 'append', deps.readLiveMessages);
      return 'preparing';
    }
    if (dto.success === true && expectedRevision !== null && dto.revision !== expectedRevision) {
      const tailDto = await api.readTail(conversationId, limit);
      if (!isCurrentWindowRequest(request)) return 'superseded';
      applyWindowResponse(tailDto, store, 'replace', deps.readLiveMessages);
      return 'replaced';
    }
    applyWindowResponse(dto, store, 'append', deps.readLiveMessages);
    return 'appended';
  } catch (error) {
    if (isCurrentWindowRequest(request)) {
      store.setError(conversationId, readErrorMessage(error));
    }
    throw error;
  }
}

export async function loadAround(
  conversationId: string,
  anchorMessageId: string,
  options: LoadMessageWindowOptions,
  deps: MessageWindowLoaderDeps,
): Promise<LoadAroundResult> {
  const store = deps.store ?? useMessageWindowStore();
  const api = deps.api ?? messageWindowApi;
  const limit = options.limit ?? readDefaultMessageWindowLimit();
  const request = beginWindowRequest(store, conversationId, 'around');

  try {
    const dto = await api.readAround(conversationId, anchorMessageId, limit);
    if (!isCurrentWindowRequest(request)) return 'superseded';
    if (dto.success === false && 'status' in dto) {
      applyWindowResponse(dto, store, 'replace', deps.readLiveMessages);
      return 'preparing';
    }
    applyWindowResponse(dto, store, 'replace', deps.readLiveMessages);
    return 'replaced';
  } catch (error) {
    if (isCurrentWindowRequest(request)) {
      store.setError(conversationId, readErrorMessage(error));
    }
    throw error;
  }
}

function applyWindowResponse(
  dto: UiMessagesWindowDto,
  store: MessageWindowStore,
  mode: 'replace' | 'prepend' | 'append',
  readLiveMessages: MessageWindowLoaderDeps['readLiveMessages'],
): void {
  if (dto.success === false) {
    if ('status' in dto) {
      store.setPreparing(dto.conversation_id);
      return;
    }
    throw new Error(dto.error);
  }

  const snapshot = buildSnapshot(dto);
  const liveMessages = readLiveMessages(snapshot.conversationId);
  admitWindowAndLiveMessages(snapshot.rows, liveMessages);
  if (mode === 'prepend') {
    store.prependSnapshot(snapshot);
    return;
  }
  if (mode === 'append') {
    store.appendSnapshot(snapshot);
    return;
  }
  store.replaceWithSnapshot(snapshot);
}

function buildSnapshot(dto: UiMessagesWindowReadyDto): MessageWindowSnapshot {
  const rows = mapUiMessagesWindowDtoToRows(dto);
  return createMessageWindowSnapshot(dto, rows);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error';
}
