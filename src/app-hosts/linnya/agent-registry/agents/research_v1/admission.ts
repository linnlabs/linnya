import {
  ResearchRunArgsSchema,
  type HostToolCallRequestData,
  type ResearchRunArgs,
} from '@app/schemas';
import type { AgentInvokeRequest } from '../../../context/agent/contracts';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { AgentRequestAdmissionContext } from '../../types';

export class ResearchAdmissionError extends Error {
  constructor(
    readonly code:
      | 'RESEARCH_CONTEXT_NOT_SUPPORTED'
      | 'RESEARCH_PROJECT_REQUIRED'
      | 'RESEARCH_HOST_ENTRY_NOT_SUPPORTED',
    message: string
  ) {
    super(message);
    this.name = 'ResearchAdmissionError';
  }
}

/** 普通研究以开放调查启动；CLI 显式范围仍保持原有严格、独立材料合同。 */
export function resolveResearchAdmission(
  request: AgentInvokeRequest,
  explicitArgs?: HostToolCallRequestData['args'],
  history: readonly RuntimeEvent[] = []
): ResearchRunArgs {
  if (!request.project_metadata?.id) {
    throw new ResearchAdmissionError(
      'RESEARCH_PROJECT_REQUIRED',
      '请先进入项目，再使用“研究”。研究记录、评审和文章将保存在该项目中。'
    );
  }
  if ((request.currentUserAttachments?.length ?? 0) > 0) {
    throw new ResearchAdmissionError(
      'RESEARCH_CONTEXT_NOT_SUPPORTED',
      '研究尚不支持直接交接图片附件。请将所需资料保存为项目文档，或提供可读取的原始链接。'
    );
  }
  if (!explicitArgs) {
    return ResearchRunArgsSchema.parse({
      question: request.query,
      reader:
        'Use the reader and language requested by the user; otherwise write an accessible article for a general reader in the user’s language.',
      task_type: 'open',
      materials: [],
    });
  }
  const unboundContext =
    history.length > 0 ||
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
  return ResearchRunArgsSchema.parse(explicitArgs);
}

/** 原请求与 scope 是两个独立事实；主模型读取上下文，Host 不再把历史改写成工具问题。 */
export function admitResearchRequest(
  request: AgentInvokeRequest,
  context: AgentRequestAdmissionContext
): AgentInvokeRequest {
  if (context.hostToolCall) {
    throw new ResearchAdmissionError(
      'RESEARCH_HOST_ENTRY_NOT_SUPPORTED',
      '新研究任务须从研究 Agent 启动；显式范围请使用 research_scope。已接纳的研究运行仍可按原身份恢复。'
    );
  }
  return {
    ...request,
    researchScope: resolveResearchAdmission(request, request.researchScope, context.history),
  };
}
