import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';

import type {
  FlowConversationAdmissionInput,
  FlowConversationAdmissionPort,
} from '../flow.persistence';

interface DirectConversationFactsDelegate {
  ensureConversation(
    conversationId: string,
    initialEvents: RuntimeEvent[],
    projectId?: string,
    mode?: string,
  ): Promise<void>;
}

/**
 * 仅供既有 Flow 测试隔离 lifecycle 文件系统时使用。生产组合根禁止使用这个直通 port；
 * 生产必须注入 conversation-lifecycle scope，才能让 cleanup barrier 与 owner 注册原子排序。
 */
export function createDirectFlowConversationAdmissionPort(
  delegate: DirectConversationFactsDelegate,
): FlowConversationAdmissionPort {
  return Object.freeze({
    async withConversationAdmission<T>(input: FlowConversationAdmissionInput<T>): Promise<T> {
      await delegate.ensureConversation(
        input.conversationId,
        [...input.initialEvents],
        input.projectId,
        input.mode,
      );
      return input.admitted();
    },
  });
}
