import { describe, expect, it } from 'vitest';
import { ResearchRunArgsSchema } from '@app/schemas';
import {
  createFinalAnswerEvent,
  createHistorySummaryEvent,
  createThoughtEvent,
  createUserInputEvent,
} from '@linnlabs/linnkit/contracts';
import type { AgentInvokeRequest } from '../../../context/agent/contracts';
import { resolveResearchAdmission } from './admission';

const request: AgentInvokeRequest = {
  promptKey: 'research_v1',
  query: '只使用提供的原文，解释样本差异。正文不超过一千字。',
  project_metadata: { id: 'project-1' },
};
const args = {
  question: '样本差异如何解释？',
  reader: '普通中文读者',
  task_type: 'fixed',
  materials: ['workspace:/source.md'],
};

describe('research admission', () => {
  it('普通研究冻结完整请求与引用片段，不把片段宣称为已绑定全文', () => {
    const admitted = ResearchRunArgsSchema.parse(
      resolveResearchAdmission({
        ...request,
        document_fragment: 'Selected source text',
      })
    );
    expect(admitted).toMatchObject({ task_type: 'open', materials: [] });
    expect(admitted.question).toContain(request.query);
    expect(admitted.question).toContain('Selected source text');
    expect(admitted.question).toContain('only that excerpt');
  });

  it('交接压缩后的可见历史，保留文章链接并排除旧正文与隐藏推理', () => {
    const admitted = ResearchRunArgsSchema.parse(
      resolveResearchAdmission(request, undefined, [
        createUserInputEvent('old-user', 'conversation', 'turn', 'superseded long text'),
        createHistorySummaryEvent(
          'summary',
          'conversation',
          'turn',
          'retained summary',
          ['old-user'],
          1,
          1
        ),
        createFinalAnswerEvent('answer', 'conversation', 'turn', '[文章](workspace:/revision.md)', {
          completion_reason: 'terminal',
        }),
        createThoughtEvent('thought', 'conversation', 'turn', 'hidden scratchpad'),
      ])
    );
    expect(admitted.question).toContain('retained summary');
    expect(admitted.question).toContain('workspace:/revision.md');
    expect(admitted.question).not.toContain('superseded long text');
    expect(admitted.question).not.toContain('hidden scratchpad');
  });

  it('无项目在接纳前给出可操作错误', () => {
    expect(() => resolveResearchAdmission({ ...request, project_metadata: undefined })).toThrow(
      expect.objectContaining({ code: 'RESEARCH_PROJECT_REQUIRED' })
    );
  });

  it('preserves the complete user constraints alongside the admitted research focus', () => {
    const admitted = ResearchRunArgsSchema.parse(resolveResearchAdmission(request, args));
    expect(admitted.task_type).toBe('fixed');
    expect(admitted.materials).toEqual(['workspace:/source.md']);
    expect(admitted.question).toContain(request.query);
    expect(admitted.question).toContain(args.question);
  });

  const unbound: readonly Partial<AgentInvokeRequest>[] = [
    {
      currentUserAttachments: [
        {
          id: 'image-1',
          kind: 'image',
          resourceId: 'asset-1',
          mediaType: 'image/png',
          byteLength: 100,
          width: 10,
          height: 10,
          sha256: 'a'.repeat(64),
        },
      ],
    },
    {
      user_quote: {
        items: [
          {
            quote_id: 'reference-11111111111111111111111111111111',
            plugin_id: 'platform',
            kind: 'text-selection',
            text: 'Important selection',
          },
        ],
      },
    },
    {
      conversationHistory: [
        {
          id: 'previous-user-input',
          type: 'user_input',
          timestamp: 1,
          role: 'user',
          content: 'Do not omit this earlier constraint.',
        },
      ],
    },
    { document_fragment: 'Selected source text' },
    { fences: [{ kind: 'selected-source', content: 'Exact source' }] },
  ];
  it.each(unbound)('refuses unbound context instead of silently dropping it: %o', context => {
    expect(() => resolveResearchAdmission({ ...request, ...context }, args)).toThrow(
      expect.objectContaining({ code: 'RESEARCH_CONTEXT_NOT_SUPPORTED' })
    );
  });
  it('普通入口同样不静默丢弃图片', () => {
    expect(() => resolveResearchAdmission({ ...request, ...unbound[0] })).toThrow(
      expect.objectContaining({ code: 'RESEARCH_CONTEXT_NOT_SUPPORTED' })
    );
  });
});
