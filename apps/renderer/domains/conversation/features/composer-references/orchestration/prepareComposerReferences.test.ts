import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { generateConversationReferenceId } from '@app/schemas';
import type { ConversationReferenceKindContribution } from '@linnya/plugin-host-contract/renderer';
import { createConversationReference } from '../../../functions/conversationReferences';
import { clearConversationReferenceKindsForTest, registerConversationReferenceKind, unregisterConversationReferenceKind } from '../registry/conversationReferenceKindRegistry';
import { useComposerReferences } from './useComposerReferences';
import { prepareComposerReferences } from './prepareComposerReferences';

const kindBase = { pluginId: 'example', kind: 'selected', chip: { label: () => '引用', preview: () => '预览' } };
const reference = () => createConversationReference({ pluginId: 'example', kind: 'selected', text: '加入时旧内容', metadata: { ids: ['a'] } }, generateConversationReferenceId());
afterEach(clearConversationReferenceKindsForTest);

function run(kind: ConversationReferenceKindContribution) {
  registerConversationReferenceKind(kind);
  const abort = new AbortController();
  const references = [reference()];
  const isCurrent = vi.fn(() => true);
  const pending = prepareComposerReferences({ references, conversationId: 'conversation', projectId: 'project', signal: abort.signal, isCurrent });
  return { abort, references, isCurrent, pending };
}

describe('composer reference preparation', () => {
  it('发送等待刷新，冻结本次版本并保留草稿中的加入时内容', async () => {
    let resolve: ((content: { text: string; metadata: { version: number } }) => void) | undefined;
    const { pending, references } = run({ ...kindBase, prepareForSend: async () => new Promise(done => { resolve = done; }) });
    const content = { text: '最新正文', metadata: { version: 2 } };
    resolve?.(content);
    const frozen = await pending;
    content.metadata.version = 3;
    expect(frozen[0]?.text).toBe('最新正文');
    expect(frozen[0]?.metadata).toEqual({ version: 2 });
    expect(frozen[0]?.id).toBe(references[0]?.id);
    expect(references[0]?.text).toBe('加入时旧内容');
  });

  it('刷新失败拒绝发送而不回退旧正文', async () => {
    const { pending, references } = run({ ...kindBase, prepareForSend: async () => { throw new Error('读取失败'); } });
    await expect(pending).rejects.toThrow('读取失败');
    expect(references[0]?.text).toBe('加入时旧内容');
  });

  it('切换输入会话或移除引用后，不接纳正在等待的旧响应', async () => {
    let resolve: ((content: { text: string }) => void) | undefined;
    const { pending, isCurrent } = run({ ...kindBase, prepareForSend: async () => new Promise(done => { resolve = done; }) });
    isCurrent.mockReturnValue(false);
    resolve?.({ text: '晚到内容' });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('取消立即退出，即使 provider 尚未响应', async () => {
    const { pending, abort } = run({ ...kindBase, prepareForSend: async () => new Promise(() => {}) });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('等待期间插件注销，不接纳其旧内容', async () => {
    let resolve: ((content: { text: string }) => void) | undefined;
    const { pending } = run({ ...kindBase, prepareForSend: async () => new Promise(done => { resolve = done; }) });
    unregisterConversationReferenceKind(kindBase.pluginId, kindBase.kind);
    resolve?.({ text: '晚到内容' });
    await expect(pending).rejects.toThrow('不可用');
  });

  it('静态引用沿用原内容且不改变身份', async () => {
    const { pending, references } = run(kindBase);
    expect(await pending).toEqual(references);
  });

  it('真实 Pinia 引用中的响应式 metadata 能安全冻结', async () => {
    setActivePinia(createPinia());
    registerConversationReferenceKind(kindBase);
    const composer = useComposerReferences();
    composer.addReference({ pluginId: 'example', kind: 'selected', text: '文本', metadata: { ids: ['a'] } });
    const prepared = await prepareComposerReferences({ references: composer.references.value, conversationId: null, projectId: null, signal: new AbortController().signal, isCurrent: () => true });
    expect(prepared[0]?.metadata).toEqual({ ids: ['a'] });
  });
});
