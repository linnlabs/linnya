/**
 * @file packages/plugins/mindmap/src/backend/agents/mindmap/workflow_leader/index.test.ts
 * @description MindMap Workflow Leader 基础配置测试
 */

import { describe, it, expect } from 'vitest';
import { AGENT_DEFINITION } from './index';

describe('MindMap workflow leader agent config', () => {
  it('mindmap_workflow_leader 必须存在且工具白名单只包含读结构 + subrun 工具', () => {
    const def = AGENT_DEFINITION;
    expect(def).toBeDefined();
    expect(def?.config?.enableTools).toBe(true);

    // 必须包含
    expect(def?.config?.availableTools).toEqual(
      expect.arrayContaining([
        'read_file',
        'mindmap_subrun_decompose',
        'mindmap_subrun_propose',
        'mindmap_subrun_validate',
        'mindmap_subrun_parallel',
      ])
    );

    // 禁止父 agent 直接写图
    expect(def?.config?.availableTools).not.toEqual(expect.arrayContaining(['mindmap_create_node']));
    expect(def?.config?.availableTools).not.toEqual(expect.arrayContaining(['mindmap_tag_node']));
    expect(def?.config?.availableTools).not.toEqual(expect.arrayContaining(['mindmap_attach_evidence']));
  });
});
