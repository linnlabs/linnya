import { ResearchRunArgsSchema, type HostToolCallRequestData } from '@app/schemas';
import type { AgentInvokeRequest } from '../../../context/agent/contracts';

export class ResearchAdmissionError extends Error {
  constructor(
    readonly code: 'RESEARCH_SCOPE_REQUIRED' | 'RESEARCH_CONTEXT_NOT_SUPPORTED',
    message: string
  ) {
    super(message);
    this.name = 'ResearchAdmissionError';
  }
}

/** 工程入口只接纳显式范围，不能把附件、旧会话或编辑器选择静默降为开放网页研究。 */
export function resolveResearchAdmission(
  request: AgentInvokeRequest,
  explicitArgs?: HostToolCallRequestData['args']
): HostToolCallRequestData['args'] {
  if (!explicitArgs) {
    throw new ResearchAdmissionError(
      'RESEARCH_SCOPE_REQUIRED',
      '研究工程入口需要显式声明问题、读者、任务模式和 Workspace 材料；尚未开放普通消息接纳。'
    );
  }
  const unboundContext =
    (request.currentUserAttachments?.length ?? 0) > 0 ||
    (request.conversationHistory?.length ?? 0) > 0 ||
    (request.fences?.length ?? 0) > 0 ||
    request.user_quote !== undefined ||
    request.document_metadata !== undefined ||
    [
      request.context_before,
      request.context_after,
      request.currentBlockContent,
      request.document_fragment,
      request.current_paragraph,
      request.document_title,
      request.injected_context,
    ].some(value => Boolean(value?.trim()));
  if (unboundContext) {
    throw new ResearchAdmissionError(
      'RESEARCH_CONTEXT_NOT_SUPPORTED',
      '研究工程入口不能隐式交接附件、历史或编辑器上下文。请用独立会话，将所需材料保存为 Workspace 文档并显式声明范围。'
    );
  }
  const args = ResearchRunArgsSchema.parse(explicitArgs);
  // 保留原始交付约束与时间信息；显式的研究焦点不能覆盖用户原话。
  return {
    ...args,
    question: `原始用户请求（完整保留）：\n${request.query}\n\n本次接纳的研究问题：\n${args.question}`,
  };
}
