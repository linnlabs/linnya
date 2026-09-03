/**
 * @file src/app-hosts/linnya/agent-registry/agents/__tests__/deepResearchAgents.test.ts
 * @description Deep Research Agents 基础配置测试（Phase 1）
 */

import { describe, expect, it } from 'vitest';
import { ALL_AGENT_DEFINITIONS_FOR_TESTS } from '../index';
import { PromptKeys } from '../../prompt.types';
import defaultAgent from '../default';

function findByPromptKey(promptKey: string) {
  return ALL_AGENT_DEFINITIONS_FOR_TESTS.find(d => d.promptKey === promptKey);
}

describe('Deep Research agent configs', () => {
  it('default agent should expose workspace path list/read tools for local testing', () => {
    expect(defaultAgent.config?.skill?.enabled).toBe(true);
    expect(defaultAgent.config?.availableTools).toEqual(
      expect.arrayContaining([
        'list_files',
        'read_file',
        'grep',
        'edit_file',
        'write_file',
        'web_search',
        'web_read',
        'tool_output_read',
      ])
    );
    expect(defaultAgent.config?.availableTools).not.toContain('evidence_resolve');
    expect(defaultAgent.config?.availableTools).not.toEqual(
      expect.arrayContaining([
        'resource_list',
        'resource_read',
        'markdown_edit',
      ])
    );
  });

  it('default agent 注入 TaskState reminder', () => {
    const policy = defaultAgent.config?.contextPolicy?.systemReminder;

    expect(policy?.enabledRuleIds).toEqual(
      expect.arrayContaining([
        'linnya_periodic_taskstate_reflection',
      ])
    );
    expect(policy?.extraRules?.map(rule => rule.id)).toEqual(
      expect.arrayContaining([
        'linnya_periodic_taskstate_reflection',
      ])
    );
    expect(policy?.extraRules?.map(rule => rule.contentTemplate)).toEqual(['hostReminderText']);
  });

  it('deep_research_scout 使用 Workspace 协作文档，并由 Knowledge 生产者自动捕获证据', () => {
    const def = findByPromptKey(PromptKeys.DEEP_RESEARCH_SCOUT);
    expect(def).toBeDefined();
    expect(def?.config?.enableTools).toBe(true);
    expect(def?.config?.availableTools).toEqual(
      expect.arrayContaining([
        'list_files',
        'read_file',
        'write_file',
        'edit_file',
        'evidence_resolve',
      ])
    );
    expect(def?.config?.availableTools).not.toContain('assemble_evidence');
    if (!def?.task?.systemPromptBuilder) {
      throw new Error('Deep Research Scout system prompt builder is required.');
    }
    const prompt = def.task.systemPromptBuilder({
      query: '研究问题',
      promptKey: PromptKeys.DEEP_RESEARCH_SCOUT,
    });
    expect(prompt).toContain('canonical `[@XXXXXX]` refs');
    expect(prompt).not.toContain('bundle_id');
  });

  it('deep_research_* 应配置 MaxSteps 收尾提示策略（stepPolicy.lastStepsHintThreshold）', () => {
    // 子角色使用 force_tools 策略，确保协作文档通过正式工具落盘。
    const forceToolsKeys = [
      PromptKeys.DEEP_RESEARCH_SCOUT,
      PromptKeys.DEEP_RESEARCH_REASONER_1,
      PromptKeys.DEEP_RESEARCH_CHALLENGER,
      PromptKeys.DEEP_RESEARCH_REASONER_2,
    ] as const;

    for (const k of forceToolsKeys) {
      const def = findByPromptKey(k);
      expect(def, `missing agent definition: ${k}`).toBeDefined();
      expect(def?.config?.stepPolicy?.kind).toBe('force_tools');
      expect(def?.config?.stepPolicy?.forcedTools).toEqual(['write_file']);
      expect(typeof def?.config?.stepPolicy?.lastStepsHintThreshold).toBe('number');
      expect((def?.config?.stepPolicy?.lastStepsHintThreshold ?? 0) > 0).toBe(true);
    }

    // Leader 自己完成最终写作，并通过 write_report 原子发布最终答案。
    const leader = findByPromptKey(PromptKeys.DEEP_RESEARCH_LEADER);
    expect(leader).toBeDefined();
    expect(leader?.config?.stepPolicy).toMatchObject({
      kind: 'force_tools',
      forcedTools: ['write_report'],
    });
    expect(typeof leader?.config?.stepPolicy?.lastStepsHintThreshold).toBe('number');
    expect((leader?.config?.stepPolicy?.lastStepsHintThreshold ?? 0) > 0).toBe(true);
  });

  it('Deep Research 活跃 Prompt 只教 Agent 使用 canonical ref，不暴露 Evidence 存储容器心智', () => {
    const keys = [
      PromptKeys.DEEP_RESEARCH_LEADER,
      PromptKeys.DEEP_RESEARCH_SCOUT,
      PromptKeys.DEEP_RESEARCH_REASONER_1,
      PromptKeys.DEEP_RESEARCH_CHALLENGER,
      PromptKeys.DEEP_RESEARCH_REASONER_2,
    ] as const;

    for (const promptKey of keys) {
      const definition = findByPromptKey(promptKey);
      if (!definition?.task?.systemPromptBuilder) {
        throw new Error(`Deep Research prompt builder is required: ${promptKey}`);
      }
      const prompt = definition.task.systemPromptBuilder({ query: '研究问题', promptKey });
      expect(prompt).toContain('[@XXXXXX]');
      expect(prompt).not.toMatch(/EvidenceStore|bundle_id|evidence bundles?/i);
      expect(prompt).not.toContain('assemble_evidence');
    }
  });

  it('deep_research 所有角色应使用 Workspace 文件工具交换协作文档', () => {
    const keys = [
      PromptKeys.DEEP_RESEARCH_LEADER,
      PromptKeys.DEEP_RESEARCH_SCOUT,
      PromptKeys.DEEP_RESEARCH_REASONER_1,
      PromptKeys.DEEP_RESEARCH_CHALLENGER,
      PromptKeys.DEEP_RESEARCH_REASONER_2,
    ] as const;

    for (const k of keys) {
      const def = findByPromptKey(k);
      expect(def, `missing agent definition: ${k}`).toBeDefined();
      const tools = Array.isArray(def?.config?.availableTools) ? def?.config?.availableTools : [];
      expect(tools).toContain('list_files');
      expect(tools).toContain('read_file');
      expect(tools).not.toContain('resource_read');
      expect(tools).toContain('knowledge_read');
      expect(tools).not.toContain('resource_list');
      expect(tools).not.toContain('sharedmemory_list');
      expect(tools).not.toContain('sharedmemory_read');
      expect(tools).not.toContain('sharedmemory_write');
      expect(tools).not.toContain('list_knowledge_base');
      expect(tools).not.toContain('browse_document_by_chunk');
      expect(tools).not.toContain('assemble_evidence');
      expect(tools).toContain('tool_output_read');

      if (k !== PromptKeys.DEEP_RESEARCH_LEADER) {
        expect(tools).toContain('evidence_resolve');
      }
      expect(tools).toContain('write_file');
      expect(tools).toContain('edit_file');

      if (!def?.task?.systemPromptBuilder) {
        throw new Error(`Deep Research prompt builder is required: ${k}`);
      }
      const prompt = def.task.systemPromptBuilder({ query: '研究问题', promptKey: k });
      expect(prompt).toContain('workspace:/research-');
      expect(prompt).not.toMatch(/(?:read_file|write_file|edit_file|list_files)\(path=/);
      expect(prompt).not.toMatch(/(?<!workspace:)\/research-[a-z0-9-]+\.md/);
    }
  });

  it('Deep Research Leader 通过 canonical subagent 调度普通研究角色', () => {
    const leader = findByPromptKey(PromptKeys.DEEP_RESEARCH_LEADER);
    const tools = Array.isArray(leader?.config?.availableTools) ? leader.config.availableTools : [];

    expect(tools).toContain('subagent');
    expect(tools).toContain('write_report');
    expect(tools).not.toContain('research_run_scout');
    expect(tools).not.toContain('research_run_reasoner');
    expect(tools).not.toContain('research_run_challenger');
    expect(tools).not.toContain('research_run_writer');
  });

  it('Leader prompt 直接消费 citation-aware 文档，不再要求 Writer 或 Evidence snapshot', () => {
    const leader = findByPromptKey(PromptKeys.DEEP_RESEARCH_LEADER);
    if (!leader?.task?.systemPromptBuilder) {
      throw new Error('Deep Research Leader system prompt builder is required.');
    }
    const prompt = leader.task.systemPromptBuilder({
      query: '研究问题',
      promptKey: PromptKeys.DEEP_RESEARCH_LEADER,
    });

    expect(prompt).toContain('snapshot_status=persisted source_status=not_checked');
    expect(prompt).toContain('write_report(report="...")');
    expect(prompt).not.toContain('research_run_writer');
    expect(prompt).not.toContain('research-evidence-snapshot');
  });
});
