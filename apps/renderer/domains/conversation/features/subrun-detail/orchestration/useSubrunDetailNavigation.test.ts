import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubrunDetailScope } from '../definitions/subrunDetail';
import {
  requestSubrunDetailReturnToParent,
  useSubrunDetailSurfaceScope,
} from '../store/subrunDetailSurfaceStore';
import { useSubrunDetailNavigation } from './useSubrunDetailNavigation';

const DETAIL_SCOPE: SubrunDetailScope = {
  conversationId: 'conversation-parent',
  parentMessageId: 'msg_parent-subagent',
  parentToolCallId: 'call-parent-subagent',
  subrunId: 'subrun-child',
  description: '读取报告',
};

describe('useSubrunDetailNavigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('publishes one shared detail scope and clears it before restoring the parent anchor', async () => {
    const conversationId = ref<string | null>('conversation-parent');
    const restoreAnchor = vi.fn(async () => undefined);
    const vueScope = effectScope();
    const navigation = vueScope.run(() => useSubrunDetailNavigation({
      conversationId,
      captureAnchor: parentMessageId => ({ parentMessageId, offsetTop: 24 }),
      restoreAnchor,
    }));
    if (!navigation) throw new Error('Expected navigation orchestration');

    const sharedScope = useSubrunDetailSurfaceScope();
    navigation.port.open(DETAIL_SCOPE);
    expect(navigation.scope.value).toEqual(DETAIL_SCOPE);
    expect(sharedScope.value).toEqual(DETAIL_SCOPE);

    navigation.port.close();
    expect(sharedScope.value).toBeNull();
    await nextTick();
    await Promise.resolve();
    expect(restoreAnchor).toHaveBeenCalledWith({
      parentMessageId: DETAIL_SCOPE.parentMessageId,
      offsetTop: 24,
    });

    vueScope.stop();
  });

  it('ends the detail surface when the owning conversation changes', async () => {
    const conversationId = ref<string | null>('conversation-parent');
    const vueScope = effectScope();
    const navigation = vueScope.run(() => useSubrunDetailNavigation({
      conversationId,
      captureAnchor: parentMessageId => ({ parentMessageId, offsetTop: 0 }),
      restoreAnchor: async () => undefined,
    }));
    if (!navigation) throw new Error('Expected navigation orchestration');

    navigation.port.open(DETAIL_SCOPE);
    conversationId.value = 'conversation-next';
    await nextTick();
    expect(navigation.scope.value).toBeNull();

    vueScope.stop();
  });

  it('routes the Header return request through the Host-owned close workflow', async () => {
    const conversationId = ref<string | null>('conversation-parent');
    const restoreAnchor = vi.fn(async () => undefined);
    const vueScope = effectScope();
    const navigation = vueScope.run(() => useSubrunDetailNavigation({
      conversationId,
      captureAnchor: parentMessageId => ({ parentMessageId, offsetTop: 18 }),
      restoreAnchor,
    }));
    if (!navigation) throw new Error('Expected navigation orchestration');

    navigation.port.open(DETAIL_SCOPE);
    requestSubrunDetailReturnToParent();
    await nextTick();
    await Promise.resolve();

    expect(navigation.scope.value).toBeNull();
    expect(restoreAnchor).toHaveBeenCalledWith({
      parentMessageId: DETAIL_SCOPE.parentMessageId,
      offsetTop: 18,
    });
    vueScope.stop();
  });
});
