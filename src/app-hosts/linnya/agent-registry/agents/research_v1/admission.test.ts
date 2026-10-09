import { describe, expect, it } from 'vitest';
import { ResearchRunArgsSchema } from '@app/schemas';
import type { AgentInvokeRequest } from '../../../context/agent/contracts';
import { resolveResearchAdmission } from './admission';

const request: AgentInvokeRequest = {
  promptKey: 'research_v1',
  query: '只使用提供的原文，解释样本差异。正文不超过一千字。',
};
const args = {
  question: '样本差异如何解释？',
  reader: '普通中文读者',
  task_type: 'fixed',
  materials: ['workspace:/source.md'],
};

describe('research engineering admission', () => {
  it('does not guess open research when the caller has not supplied a scope', () => {
    expect(() => resolveResearchAdmission(request)).toThrow(
      expect.objectContaining({ code: 'RESEARCH_SCOPE_REQUIRED' })
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
    { conversationHistory: [{ id: 'previous-user-input', type: 'user_input', timestamp: 1, role: 'user', content: 'Do not omit this earlier constraint.' }] },
    { document_fragment: 'Selected source text' },
    { fences: [{ kind: 'selected-source', content: 'Exact source' }] },
  ];
  it.each(unbound)('refuses unbound context instead of silently dropping it: %o', context => {
    expect(() => resolveResearchAdmission({ ...request, ...context }, args)).toThrow(
      expect.objectContaining({ code: 'RESEARCH_CONTEXT_NOT_SUPPORTED' })
    );
  });
});
