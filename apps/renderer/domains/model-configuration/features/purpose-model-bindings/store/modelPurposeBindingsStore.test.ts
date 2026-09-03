import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useModelPurposeBindingsStore } from './modelPurposeBindingsStore';

describe('model purpose bindings store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('按模型记住独立的推理强度，并在切回模型时恢复', () => {
    const store = useModelPurposeBindingsStore();

    store.setPrimaryModel('gpt');
    store.setPrimaryReasoningEffort('gpt', 'high');
    store.setPrimaryModel('deepseek');
    store.setPrimaryReasoningEffort('deepseek', 'low');

    store.setPrimaryModel('gpt');
    expect(store.primaryReasoningEffort).toBe('high');
    store.setPrimaryModel('deepseek');
    expect(store.primaryReasoningEffort).toBe('low');
  });

  it('删除模型绑定时一并清除它的推理强度偏好', () => {
    const store = useModelPurposeBindingsStore();
    store.setPrimaryModel('gpt');
    store.setPrimaryReasoningEffort('gpt', 'high');

    store.forgetPrimaryReasoningEffort('gpt');

    expect(store.primaryReasoningEffortsByModelId).toEqual({});
  });
});
