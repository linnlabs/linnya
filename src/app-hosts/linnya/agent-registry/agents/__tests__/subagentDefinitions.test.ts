/**
 * @file src/app-hosts/linnya/agent-registry/agents/__tests__/subagentDefinitions.test.ts
 * @description subagent_* 基础配置测试
 */

import { describe, expect, it } from 'vitest';

import { ALL_AGENT_DEFINITIONS_FOR_TESTS } from '../index';
import { PromptKeys } from '../../prompt.types';
import { SUBAGENT_DOCUMENT_EDITOR_PROMPT } from '../subagent_document_editor/prompt';
import { SUBAGENT_GENERAL_PROMPT } from '../subagent_general/prompt';
import { PROJECT_PLANNING_PROMPT } from '../project_planning/prompt';

function findByPromptKey(promptKey: string) {
  return ALL_AGENT_DEFINITIONS_FOR_TESTS.find((d) => d.promptKey === promptKey);
}

describe('subagent definitions', () => {
  it('通用/编辑型子 agent 应配置最后几步提醒，但不强制固定工具', () => {
    const finalAnswerDefinitions = [
      findByPromptKey(PromptKeys.SUBAGENT_GENERAL),
      findByPromptKey(PromptKeys.SUBAGENT_DOCUMENT_EDITOR),
    ];

    for (const def of finalAnswerDefinitions) {
      expect(def).toBeDefined();
      expect(def?.config?.stepPolicy?.kind).toBe('final_answer');
      expect(def?.config?.stepPolicy?.lastStepsHintThreshold).toBe(12);
      expect(def?.config?.contextPolicy?.systemReminder?.enabledRuleIds).toEqual(
        expect.arrayContaining(['max_steps_force_final_answer', 'last_steps_hint'])
      );
    }
  });

  it('subagent_document_editor 应使用文件工具替代旧 markdown_edit', () => {
    const def = findByPromptKey(PromptKeys.SUBAGENT_DOCUMENT_EDITOR);

    expect(def).toBeDefined();
    expect(def?.config?.availableTools).toEqual(expect.arrayContaining([
      'list_files',
      'read_file',
      'grep',
      'edit_file',
      'write_file',
      'search_in_knowledgebase',
    ]));
    expect(def?.config?.availableTools).not.toContain('markdown_edit');
    expect(def?.config?.availableTools).not.toContain('sharedmemory_write');
    expect(def?.config?.availableTools).not.toContain('resource_list');
    expect(def?.config?.availableTools).not.toContain('resource_read');
    expect(def?.config?.availableTools).not.toContain('task_read');
    expect(def?.config?.availableTools).not.toContain('task_write');
    expect(SUBAGENT_DOCUMENT_EDITOR_PROMPT.content).toContain('edit_file');
    expect(SUBAGENT_DOCUMENT_EDITOR_PROMPT.content).toContain('write_file');
    expect(SUBAGENT_DOCUMENT_EDITOR_PROMPT.content).not.toContain('markdown_edit');
  });

  it('subagent_general 应使用文件工具且不能递归委派', () => {
    const def = findByPromptKey(PromptKeys.SUBAGENT_GENERAL);

    expect(def).toBeDefined();
    expect(def?.config?.availableTools).toEqual(expect.arrayContaining([
      'list_files',
      'read_file',
      'grep',
      'edit_file',
      'write_file',
      'web_read',
    ]));
    expect(def?.config?.availableTools).not.toContain('evidence_resolve');
    expect(def?.config?.availableTools).not.toContain('markdown_edit');
    expect(def?.config?.availableTools).not.toContain('mindmap_create_node');
    expect(def?.config?.availableTools).not.toContain('sharedmemory_write');
    expect(def?.config?.availableTools).not.toContain('subagent');
    expect(def?.config?.availableTools).not.toContain('delegate');
    expect(def?.config?.availableTools).not.toContain('resource_read');
    expect(def?.config?.availableTools).not.toContain('task_read');
    expect(def?.config?.availableTools).not.toContain('task_write');
    expect(SUBAGENT_GENERAL_PROMPT.content).toContain('read_file');
    expect(SUBAGENT_GENERAL_PROMPT.content).toContain('edit_file');
    expect(SUBAGENT_GENERAL_PROMPT.content).not.toContain('markdown_edit');
    expect(SUBAGENT_GENERAL_PROMPT.content).not.toMatch(/mindmap/i);
  });

  it('project_planning 使用 Markdown 议题树，不无条件暴露插件文档格式', () => {
    const def = findByPromptKey(PromptKeys.PROJECT_PLANNING);

    expect(def?.config?.availableTools).toContain('list_files');
    expect(PROJECT_PLANNING_PROMPT.content).toContain('list_files(locator="workspace:/")');
    expect(PROJECT_PLANNING_PROMPT.content).toContain('Locator: "workspace:/Problem Definition.md"');
    expect(PROJECT_PLANNING_PROMPT.content).not.toMatch(/(?:list_files|write_file)\(path=/);
    expect(PROJECT_PLANNING_PROMPT.content).toContain('Issue Tree (Markdown)');
    expect(PROJECT_PLANNING_PROMPT.content).toContain('Markdown headings and nested bullets');
    expect(PROJECT_PLANNING_PROMPT.content).not.toMatch(/mindmap/i);
  });

});
