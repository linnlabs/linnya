import { describe, expect, it } from 'vitest';
import { AGENT_DEFINITION, buildDefaultAgentSystemPrompt } from './index';

describe('default agent prompt contracts', () => {
  it('默认 agent 系统提示词保留稳定产品边界且不接受插件能力注入', () => {
    const prompt = buildDefaultAgentSystemPrompt();

    expect(prompt).toContain('Workspace document types are extensible.');
    expect(prompt).toContain('Use first-principles thinking');
    expect(prompt).not.toContain("world's best Ai Consultant");
    expect(prompt).not.toContain('supports Markdown and Sheet types.');
    expect(prompt).not.toContain('MindMap');
    expect(prompt).not.toContain('plugin_linnya_capabilities');
    expect(prompt).not.toContain('Resource Library');
  });

  it('默认 agent 明确区分三种文件地址空间及其读写边界', () => {
    const prompt = buildDefaultAgentSystemPrompt();

    expect(prompt).toContain('workspace:/...');
    expect(prompt).toContain("project documents in Linnya's VFS");
    expect(prompt).toContain('conversation:/...');
    expect(prompt).toContain('files in the current conversation work directory');
    expect(prompt).toContain('file:///...');
    expect(prompt).toContain('host files by absolute path');
    expect(prompt).toContain('These spaces are separate');
    expect(prompt).toContain("plugin's CLI through `shell`");
    expect(prompt).not.toContain('plugin_command');
  });

  it('默认 agent 只通过 subagent 暴露单子 Agent 协作能力', () => {
    expect(AGENT_DEFINITION.config?.availableTools).toContain('subagent');
    expect(AGENT_DEFINITION.config?.availableTools).not.toContain('delegate');
    expect(AGENT_DEFINITION.config?.availableTools).toContain('knowledge_read');
    expect(AGENT_DEFINITION.config?.availableTools).toContain('shell');
    expect(AGENT_DEFINITION.config?.availableTools).not.toContain('plugin_command');
    expect(AGENT_DEFINITION.config?.availableTools).not.toContain('browse_document_by_chunk');
    expect(AGENT_DEFINITION.config?.availableTools).not.toContain('task');
  });
});
