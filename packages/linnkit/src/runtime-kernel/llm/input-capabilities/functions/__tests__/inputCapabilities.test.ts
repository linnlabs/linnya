import { describe, expect, it } from 'vitest';
import type { LlmRequestMessage } from '../../../../../ports';
import type { ModelCatalogEntry } from '../../../modelCatalog';
import { deriveModelInputRequirement } from '../deriveModelInputRequirement';
import {
  evaluateModelInputCompatibility,
  listCompatibleModelIds,
} from '../evaluateModelInputCompatibility';
import { mergeModelInputRequirements } from '../mergeModelInputRequirements';

const imageRef = {
  id: 'attachment-1',
  kind: 'image' as const,
  resourceId: 'asset-1',
  mediaType: 'image/png' as const,
  byteLength: 128,
  width: 16,
  height: 8,
  sha256: 'a'.repeat(64),
};

function model(overrides: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry {
  return {
    id: 'model-1',
    enabled: true,
    capabilities: ['chat', 'image_input'],
    adapter_input_support: { user_image: true, tool_result_image: true },
    ...overrides,
  };
}

describe('model input capabilities', () => {
  it('合并消息与工具 requirement 时按固定 placement 顺序去重', () => {
    const requirement = mergeModelInputRequirements(
      { requires_image_input: true, placements: ['tool_result_image'] },
      { requires_image_input: true, placements: ['user_image', 'tool_result_image'] },
    );

    expect(requirement).toEqual({
      requires_image_input: true,
      placements: ['user_image', 'tool_result_image'],
    });
    expect(Object.isFrozen(requirement.placements)).toBe(true);
  });

  it('模型声明图片能力后，由 adapter placement 决定具体图片来源是否可编码', () => {
    const toolImageRequirement = {
      requires_image_input: true,
      placements: ['tool_result_image'] as const,
    };

    expect(evaluateModelInputCompatibility(model({
      id: 'tool-image-capable-adapter',
      adapter_input_support: { user_image: true, tool_result_image: true },
    }), toolImageRequirement)).toEqual({ compatible: true });

    expect(evaluateModelInputCompatibility(model({
      id: 'user-image-only-adapter',
      adapter_input_support: { user_image: true, tool_result_image: false },
    }), toolImageRequirement)).toEqual({
      compatible: false,
      reason: 'placement_unsupported',
      missing_placements: ['tool_result_image'],
    });
  });
  it('derives immutable user and tool-result placements from final messages', () => {
    const messages: LlmRequestMessage[] = [
      { role: 'user', content: '', attachments: [imageRef] },
      { role: 'tool', tool_call_id: 'call-1', content: 'done', attachments: [imageRef] },
    ];

    const requirement = deriveModelInputRequirement(messages);

    expect(requirement).toEqual({
      requires_image_input: true,
      placements: ['user_image', 'tool_result_image'],
    });
    expect(Object.isFrozen(requirement)).toBe(true);
    expect(Object.isFrozen(requirement.placements)).toBe(true);
  });

  it('ignores empty attachment arrays and unrelated metadata', () => {
    const messages: LlmRequestMessage[] = [
      { role: 'user', content: 'plain', attachments: [] },
      {
        id: 'assistant-1',
        role: 'assistant',
        type: 'final_answer',
        content: 'ok',
        timestamp: 1,
        metadata: { attachments: [imageRef] },
      },
    ];

    expect(deriveModelInputRequirement(messages)).toEqual({
      requires_image_input: false,
      placements: [],
    });
  });

  it.each([
    { candidate: undefined, reason: 'model_missing' },
    { candidate: model({ enabled: false }), reason: 'model_disabled' },
    { candidate: model({ capabilities: ['image_input'] }), reason: 'chat_unsupported' },
    { candidate: model({ capabilities: ['chat'] }), reason: 'image_input_unsupported' },
    {
      candidate: model({ adapter_input_support: { user_image: true, tool_result_image: false } }),
      reason: 'placement_unsupported',
    },
  ] as const)('explains incompatible candidate: $reason', ({ candidate, reason }) => {
    const requirement = deriveModelInputRequirement([
      { role: 'tool', tool_call_id: 'call-1', content: '', attachments: [imageRef] },
    ]);

    expect(evaluateModelInputCompatibility(candidate, requirement)).toMatchObject({
      compatible: false,
      reason,
    });
  });

  it('keeps pure text compatible without requiring image declarations', () => {
    const requirement = deriveModelInputRequirement([{ role: 'user', content: 'plain' }]);
    expect(evaluateModelInputCompatibility(
      model({ capabilities: ['chat'], adapter_input_support: undefined }),
      requirement,
    )).toEqual({ compatible: true });
  });

  it('lists only models satisfying model and adapter capabilities', () => {
    const requirement = deriveModelInputRequirement([
      { role: 'user', content: '', attachments: [imageRef] },
    ]);
    const compatible = listCompatibleModelIds([
      model({ id: 'compatible' }),
      model({ id: 'model-only', adapter_input_support: { user_image: false, tool_result_image: false } }),
      model({ id: 'disabled', enabled: false }),
    ], requirement);

    expect(compatible).toEqual(['compatible']);
  });
});
