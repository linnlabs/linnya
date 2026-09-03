import { describe, expect, it } from 'vitest';

import { readStoredUserModelState } from '../definitions/userModelsFile';

describe('用户模型持久化 envelope', () => {
  it('保留模型为 unknown，交给统一 catalog admission 校验', () => {
    const model = { id: 'user-model', capabilities: ['chat'] };
    const endpoint = { id: 'endpoint-1' };
    expect(readStoredUserModelState({
      version: '4.0.0',
      last_updated: '2026-08-14T00:00:00.000Z',
      inference_endpoints: [endpoint],
      models: [model],
    })).toEqual({ inferenceEndpoints: [endpoint], models: [model] });
  });

  it('拒绝未知版本或损坏 envelope，不把它当作空目录', () => {
    expect(() => readStoredUserModelState({
      version: '0.9.0',
      last_updated: '2026-08-14T00:00:00.000Z',
      models: [],
    })).toThrow('version');
    expect(() => readStoredUserModelState({
      version: '4.0.0',
      last_updated: '2026-08-14T00:00:00.000Z',
      inference_endpoints: [],
      models: {},
    })).toThrow('envelope');
  });

  it('拒绝仍混用 provider 与 connection 语义的旧格式', () => {
    expect(() => readStoredUserModelState({
      version: '3.0.0',
      last_updated: '2026-07-23T04:09:41.541Z',
      models: [{
        id: 'legacy-openai-model',
        provider: 'openai',
        capabilities: ['chat'],
      }],
    })).toThrow('4.0.0');
  });
});
