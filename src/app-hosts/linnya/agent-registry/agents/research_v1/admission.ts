import { ResearchRunArgsSchema, type HostToolCallRequestData } from '@app/schemas';
import type { AgentInvokeRequest } from '../../../context/agent/contracts';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { researchConversationContext } from './admissionContext';

export class ResearchAdmissionError extends Error {
  constructor(
    readonly code: 'RESEARCH_CONTEXT_NOT_SUPPORTED' | 'RESEARCH_PROJECT_REQUIRED',
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
): HostToolCallRequestData['args'] {
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
      question: [
        '当前用户请求（完整保留）：',
        request.query,
        '',
        researchConversationContext(request, history),
        '',
        'Research entry permits source discovery, but any narrower source, time, audience or length constraints in the user request still apply. Do not infer missing facts from a title, prior answer or file list. Preserve explicit uncertainty when the request or sources do not support a conclusion.',
      ].join('\n'),
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
  const args = ResearchRunArgsSchema.parse(explicitArgs);
  // 保留原始交付约束与时间信息；显式的研究焦点不能覆盖用户原话。
  return {
    ...args,
    question: `原始用户请求（完整保留）：\n${request.query}\n\n本次接纳的研究问题：\n${args.question}`,
  };
}
