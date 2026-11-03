import { toRaw } from 'vue';
import type { ConversationReference } from '../../../types';
import { createConversationReference } from '../../../functions/conversationReferences';
import { readConversationReferenceKind } from '../registry/conversationReferenceKindRegistry';

import type { PrepareComposerReferencesOptions } from '../definitions/prepareComposerReferences';

function assertCurrent(options: PrepareComposerReferencesOptions): void {
  options.signal.throwIfAborted();
  if (!options.isCurrent()) throw new DOMException('Composer changed during reference preparation', 'AbortError');
}

/** 取消须立即释放发送等待，即使第三方 provider 尚未完成异步工作。 */
function awaitPreparation<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function prepareComposerReferences(
  options: PrepareComposerReferencesOptions,
): Promise<readonly ConversationReference[]> {
  assertCurrent(options);
  const prepared: ConversationReference[] = [];
  for (const reference of options.references) {
    const kind = readConversationReferenceKind(reference.pluginId, reference.kind);
    const frozenInput = structuredClone(toRaw(reference));
    const content = kind.prepareForSend
      ? await awaitPreparation(kind.prepareForSend(frozenInput, {
          conversationId: options.conversationId,
          signal: options.signal,
        }), options.signal)
      : frozenInput;
    assertCurrent(options);
    // 插件在等待期间停用/重注册时不能接受旧 provider 返回的正文。
    if (readConversationReferenceKind(reference.pluginId, reference.kind) !== kind) {
      throw new DOMException('Reference provider changed during preparation', 'AbortError');
    }
    prepared.push(createConversationReference({
      ...structuredClone(toRaw(content)), pluginId: reference.pluginId, kind: reference.kind,
    }, reference.id));
  }
  assertCurrent(options);
  return prepared;
}
