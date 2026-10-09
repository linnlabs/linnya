import { describe, expect, it } from 'vitest';
import { ResearchRunArgsSchema } from '@app/schemas';
import { createUserInputEvent } from '@linnlabs/linnkit/contracts';
import type { AgentInvokeRequest } from '../../../context/agent/contracts';
import { admitResearchRequest, resolveResearchAdmission } from './admission';

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
  it('普通研究保留请求和正式上下文，默认 scope 不改写为 Host 历史代理', () => {
    const input = { ...request, document_fragment: 'Selected source text' };
    const admitted = admitResearchRequest(input, {
      history: [createUserInputEvent('previous', 'conversation', 'turn', 'Earlier constraints')],
    });
    expect(admitted.query).toBe(input.query);
    expect(admitted.document_fragment).toBe(input.document_fragment);
    expect(admitted.researchScope).toMatchObject({
      question: input.query,
      task_type: 'open',
      materials: [],
    });
    expect(input).not.toHaveProperty('researchScope');
  });

  it('无项目在接纳前给出可操作错误', () => {
    expect(() => resolveResearchAdmission({ ...request, project_metadata: undefined })).toThrow(
      expect.objectContaining({ code: 'RESEARCH_PROJECT_REQUIRED' })
    );
  });

  it('显式范围与用户原约束分别保存，问题和时间范围不被改写', () => {
    const scope = ResearchRunArgsSchema.parse({ ...args, time_range: '2025–2026' });
    const admitted = admitResearchRequest({ ...request, researchScope: scope }, { history: [] });
    expect(admitted.query).toBe(request.query);
    expect(admitted.researchScope).toEqual(scope);
  });

  it('显式范围拒绝正式会话历史；新 Host 工具请求不能绕过主模型入口', () => {
    expect(() =>
      admitResearchRequest(
        { ...request, researchScope: ResearchRunArgsSchema.parse(args) },
        {
          history: [
            createUserInputEvent('previous', 'conversation', 'turn', 'Earlier constraints'),
          ],
        }
      )
    ).toThrow(expect.objectContaining({ code: 'RESEARCH_CONTEXT_NOT_SUPPORTED' }));
    expect(() =>
      admitResearchRequest(request, {
        history: [],
        hostToolCall: { tool_name: 'research_run', args, completion_mode: 'yield_after_batch' },
      })
    ).toThrow(expect.objectContaining({ code: 'RESEARCH_HOST_ENTRY_NOT_SUPPORTED' }));
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
