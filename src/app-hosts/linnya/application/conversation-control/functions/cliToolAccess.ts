import {
  CONVERSATION_CONTROL_WORKSPACE_TOOL_NAMES,
  type ConversationControlToolName,
  type ConversationControlToolsRequest,
} from '@app/schemas';
import { ConversationControlError } from '../definitions/conversationControlError';

export function selectCliTools(webEnabled: boolean): readonly ConversationControlToolName[] {
  return webEnabled
    ? [...CONVERSATION_CONTROL_WORKSPACE_TOOL_NAMES, 'web_search', 'web_read', 'tool_output_read']
    : CONVERSATION_CONTROL_WORKSPACE_TOOL_NAMES;
}

export function assertCliToolAvailable(name: ConversationControlToolName, webEnabled: boolean): void {
  if (!selectCliTools(webEnabled).includes(name)) {
    throw new ConversationControlError(
      'capability_unavailable',
      `CLI ${name} is disabled. Run linnya tools web on to enable Web access for this Host session.`,
    );
  }
}

export function assertCliToolCallAllowed(
  request: Extract<ConversationControlToolsRequest, { action: 'call' }>,
  webEnabled: boolean,
): void {
  assertCliToolAvailable(request.tool_name, webEnabled);
  // 外部 Agent 自己负责调查循环；避免无模型调用的 CLI 入口暗中启动付费子运行。
  if (request.tool_name === 'web_search' && request.args.deep_search === true) {
    throw new ConversationControlError(
      'invalid_request',
      'CLI web_search supports ordinary search only. Omit deep_search or set it to false; deep_search=true starts a Linnya model-backed child run.',
    );
  }
  if (request.tool_name === 'tool_output_read' && !request.conversation_id) {
    throw new ConversationControlError(
      'invalid_request',
      'tool_output_read requires --conversation from the original tool receipt; --project alone creates a different conversation.',
    );
  }
}
