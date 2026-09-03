import { describe, expect, it } from 'vitest';
import { knowledgeBaseToolConfigs } from './knowledgeBase';

describe('Knowledge Search tool UI registry', () => {
  it.each([
    'knowledge_search',
    'search_knowledge_base',
    'search_in_knowledgebase',
    'search_in_knowledge_base',
  ])('%s 使用同一个 presentation owner 并显式声明运行期能力', (toolName) => {
    const config = knowledgeBaseToolConfigs[toolName];
    expect(config?.presentation).toBeTypeOf('function');
    expect(config).toBeDefined();
    if (!config) throw new Error('knowledge_search config is required');
    expect('title' in config).toBe(false);
    expect(config?.runtime).toEqual({
      subrunTrace: true,
      conversationId: true,
    });
  });
});
