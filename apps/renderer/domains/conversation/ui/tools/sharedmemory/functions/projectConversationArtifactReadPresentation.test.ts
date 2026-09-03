import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectConversationArtifactReadPresentation } from './projectConversationArtifactReadPresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectConversationArtifactReadPresentation({
    sourceToolName: 'resource_read',
    uiKey: 'sharedmemory_read',
    args: { uri: 'shared_memory://docs/plan.md' },
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

describe('projectConversationArtifactReadPresentation', () => {
  it.each([
    ['shared_memory://docs/plan.md', 'shared_memory', 'conversation.tool.sharedMemory.read'],
    ['evidence://bundles/evidence-1', 'evidence', 'conversation.tool.sharedMemory.readEvidence'],
    [
      'citation_snapshot://bundles/citations-1',
      'citation_snapshot',
      'conversation.tool.sharedMemory.readCitationSnapshot',
    ],
  ] as const)('非 success 阶段只校验请求并固定来源：%s', (uri, source, titleKey) => {
    const presentation = project({
      args: { uri },
      result: { invalid: 'success payload must not be parsed' },
      status: 'loading',
    });

    expect(presentation).toMatchObject({
      data: { kind: 'lifecycle', source },
      title: { text: { key: titleKey } },
    });
  });

  it('deprecated sharedmemory_read 使用正式参数合同并产出共享结果模型', () => {
    const result = {
      data: {
        source: 'shared_memory',
        uri: 'shared_memory://docs/plan.md',
        doc_name: 'plan',
        conversation_id: 'conversation-1',
        instance_id: 'instance-1',
        version: 2,
        updated_at_ms: 123,
        size_chars: 4,
        content: 'plan',
      },
      observation: 'plan',
      observationPreviewMeta: { doc_name: 'plan' },
    };

    expect(
      project({
        sourceToolName: 'sharedmemory_read',
        args: { doc_name: 'plan' },
        result,
        status: 'success',
        phase: 'complete',
      })
    ).toMatchObject({
      data: {
        kind: 'snapshot',
        source: 'shared_memory',
        artifact: result.data,
      },
      title: { text: { key: 'conversation.tool.sharedMemory.read' } },
    });
  });

  it('resource_read evidence wrapper 在同一次 admission 完成 alias 适配与 strict parse', () => {
    const result = {
      data: {
        source: 'evidence',
        uri: 'evidence://bundles/evidence-1',
        bundle_id: 'evidence-1',
        evidence_instance_id: 'instance-1',
        item_count: 2,
        size_chars: 8,
        content: 'evidence',
      },
      observation: 'evidence',
      observationPreviewMeta: { document_name: 'evidence-1' },
    };

    expect(
      project({
        args: { uri: 'evidence://bundles/evidence-1' },
        result,
        status: 'success',
        phase: 'complete',
      })
    ).toMatchObject({
      data: {
        kind: 'snapshot',
        source: 'evidence',
        artifact: result.data,
      },
      title: { text: { key: 'conversation.tool.sharedMemory.readEvidence' } },
    });
  });

  it('拒绝请求 URI 与成功结果来源不一致', () => {
    expect(() =>
      project({
        args: { uri: 'shared_memory://docs/plan.md' },
        result: {
          data: {
            source: 'citation_snapshot',
            uri: 'citation_snapshot://bundles/citations-1',
            bundle_id: 'citations-1',
            citation_count: 1,
            size_chars: 8,
            content: 'citation',
          },
          observation: 'citation',
          observationPreviewMeta: { document_name: 'citations-1' },
        },
        status: 'success',
        phase: 'complete',
      })
    ).toThrow('result source mismatch');
  });

  it('拒绝 success 结果中的额外字段，不在 Renderer 内猜测旧协议', () => {
    expect(() =>
      project({
        result: {
          data: {
            source: 'shared_memory',
            uri: 'shared_memory://docs/plan.md',
            doc_name: 'plan',
            conversation_id: 'conversation-1',
            instance_id: 'instance-1',
            version: 1,
            updated_at_ms: null,
            size_chars: 4,
            content: 'plan',
            legacy_field: true,
          },
          observation: 'plan',
          observationPreviewMeta: { doc_name: 'plan' },
        },
        status: 'success',
        phase: 'complete',
      })
    ).toThrow();
  });
});
