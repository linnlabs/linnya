import type { BaseMessage } from '@/domains/conversation/types';
import type { UiMessagesWindowReadyDto } from '@/domains/conversation/message-window/definitions/uiMessagesDto';
import { mapUiMessagesWindowDtoToRows } from '@/domains/conversation/message-window/functions/mapUiMessageDto';
import {
  registerToolPresentationProjectionPort,
  type ToolPresentationProjectionPort,
} from '@/domains/conversation/ports/toolPresentationProjectionPort';
import { aggregateCommandExecutionMessages } from '@/domains/conversation/features/command-execution-presentation/functions/aggregateCommandExecutionMessages';
import { projectCommandExecutionPresentation } from '@/domains/conversation/features/command-execution-presentation/functions/projectCommandExecutionPresentation';

export interface CommandExecutionWindowValidationProjection {
  /** SQLite window 中每条 durable UI row 的正式 renderer message。 */
  readonly mappedMessages: readonly BaseMessage[];
  /** 经过生产同卡规则后的用户可见消息。 */
  readonly aggregatedMessages: readonly BaseMessage[];
}

const commandExecutionProjectionPort: ToolPresentationProjectionPort = {
  project(request) {
    if (request.sourceToolName !== 'shell' && request.sourceToolName !== 'process') {
      return undefined;
    }
    const uiKey = request.sourceToolName;
    return {
      uiKey,
      status: request.status,
      phase: request.phase,
      ...projectCommandExecutionPresentation({ ...request, uiKey }),
    };
  },
};

/**
 * Electron E2E 的无 DOM 出口：只验证 durable DTO、正式展示投影和同卡聚合的数据合同。
 * Vue mount 与样式不属于这条全链测试，避免把进程/持久化验收变成脆弱的组件快照。
 * 该函数只允许独立 headless fixture 调用；正式 renderer 已由 builtin host 持有唯一 port。
 */
export function projectCommandExecutionWindowForValidation(
  dto: UiMessagesWindowReadyDto,
): CommandExecutionWindowValidationProjection {
  const unregisterPort = registerToolPresentationProjectionPort(commandExecutionProjectionPort);
  try {
    const mappedMessages = mapUiMessagesWindowDtoToRows(dto).map(row => row.message);
    return {
      mappedMessages,
      aggregatedMessages: aggregateCommandExecutionMessages(mappedMessages),
    };
  } finally {
    unregisterPort();
  }
}
