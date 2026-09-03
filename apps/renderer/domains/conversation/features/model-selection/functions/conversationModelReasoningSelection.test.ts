import { describe, expect, it } from 'vitest';

import {
  encodeConversationModelReasoningSelection,
  readConversationModelReasoningSelection,
} from './conversationModelReasoningSelection';

describe('conversationModelReasoningSelection', () => {
  it('往返传递模型与思考强度，不把 UI 复合值当成持久化模型 ID', () => {
    const value = encodeConversationModelReasoningSelection('provider/model::preview', 'xhigh');

    expect(readConversationModelReasoningSelection(value)).toEqual({
      modelId: 'provider/model::preview',
      effort: 'xhigh',
    });
  });

  it('普通模型值不被误判为思考强度选择', () => {
    expect(readConversationModelReasoningSelection('gpt-5.6')).toBeNull();
  });
});
