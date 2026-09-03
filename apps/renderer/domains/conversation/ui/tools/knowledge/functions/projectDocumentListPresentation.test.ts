import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectDocumentListPresentation } from './projectDocumentListPresentation';

function input(
  patch: Partial<ToolPresentationProjectorInput> = {},
): ToolPresentationProjectorInput {
  return {
    sourceToolName: 'list_knowledge_base',
    uiKey: 'list_knowledge_base',
    args: {},
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...patch,
  };
}

describe('projectDocumentListPresentation', () => {
  it('把 legacy knowledge list 严格投影为展示文档', () => {
    const projection = projectDocumentListPresentation(input({
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          project_id: 'project_1',
          knowledge_bases: [{ id: 'kb_1', name: '产品知识库', description: null, tags: [] }],
          documents: [{ id: 'doc_1', title: '需求说明.md', kb_id: 'kb_1' }],
        },
        observation: '找到一份文档',
      },
    }));

    expect(projection.data).toEqual({
      kind: 'snapshot',
      documents: [{ id: 'doc_1', title: '需求说明.md' }],
    });
    expect(projection.title).toMatchObject({
      text: { key: 'conversation.tool.knowledgeSearch.configListTitle' },
    });
  });

  it('生命周期阶段只校验请求，不解析尚未产生的结果', () => {
    expect(projectDocumentListPresentation(input()).data).toEqual({ kind: 'lifecycle' });
  });

  it('拒绝 wrapper source 与 uiKey 分裂及非法成功结果', () => {
    expect(() => projectDocumentListPresentation(input({
      sourceToolName: 'resource_list',
      args: { source: 'workspace' },
      status: 'success',
      phase: 'complete',
      result: { invalid: true },
    }))).toThrow();

    expect(() => projectDocumentListPresentation(input({
      status: 'success',
      phase: 'complete',
      result: { data: { documents: [{ id: 'doc_1' }] }, observation: 'invalid' },
    }))).toThrow();
  });
});
