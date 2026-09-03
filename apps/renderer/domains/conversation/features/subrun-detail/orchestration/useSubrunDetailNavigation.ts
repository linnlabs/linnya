import { nextTick, watch, type Ref } from 'vue';

import type {
  SubrunDetailNavigationPort,
  SubrunDetailScope,
} from '../definitions/subrunDetail';
import {
  useSubrunDetailSurfaceScope,
  useSubrunDetailSurfaceStore,
} from '../store/subrunDetailSurfaceStore';

export interface SubrunDetailReturnAnchor {
  readonly parentMessageId: SubrunDetailScope['parentMessageId'];
  readonly offsetTop: number;
}

/**
 * Host 是详情导航与返回锚点的唯一 lifecycle owner；feature store 只持有当前临时 scope，
 * 让同一 Conversation pane 的应用 Header 能读取身份。切会话直接清空，不跨会话恢复 DOM。
 */
export function useSubrunDetailNavigation(params: {
  readonly conversationId: Ref<string | null | undefined>;
  readonly captureAnchor: (parentMessageId: SubrunDetailScope['parentMessageId']) => SubrunDetailReturnAnchor;
  readonly restoreAnchor: (anchor: SubrunDetailReturnAnchor) => Promise<void>;
}): {
  readonly scope: Readonly<Ref<SubrunDetailScope | null>>;
  readonly port: SubrunDetailNavigationPort;
  reset(): void;
} {
  const surfaceStore = useSubrunDetailSurfaceStore();
  const scope = useSubrunDetailSurfaceScope();
  let returnAnchor: SubrunDetailReturnAnchor | null = null;

  const port: SubrunDetailNavigationPort = {
    open(nextScope) {
      if (!params.conversationId.value || nextScope.conversationId !== params.conversationId.value) {
        throw new Error('[SUBRUN_DETAIL_SCOPE_CONFLICT] 详情 scope 不属于当前 ConversationHost');
      }
      returnAnchor = params.captureAnchor(nextScope.parentMessageId);
      surfaceStore.setScope(nextScope);
    },
    close() {
      const anchor = returnAnchor;
      returnAnchor = null;
      surfaceStore.clearScope();
      if (!anchor) return;
      void nextTick()
        .then(() => params.restoreAnchor(anchor))
        .catch((error: unknown) => {
          console.warn('[SubrunDetail] 返回父消息锚点失败', {
            parentMessageId: anchor.parentMessageId,
            error,
          });
        });
    },
  };

  function reset(): void {
    returnAnchor = null;
    surfaceStore.clearScope();
  }

  watch(params.conversationId, reset);
  watch(
    () => surfaceStore.returnRequestRevision,
    (revision, previousRevision) => {
      if (revision === previousRevision || !scope.value) return;
      port.close();
    },
  );

  return { scope, port, reset };
}
