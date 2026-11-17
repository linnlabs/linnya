import { afterEach, describe, expect, it } from 'vitest';
import { ResearchRunArgsSchema } from '@app/schemas';
import { createGraphLoopHarness, type GraphLoopHarness } from 'src/app-hosts/linnya/testkit/agent-harness/graphLoopHarness';
import { AGENT_DEFINITION } from 'src/app-hosts/linnya/agent-registry/agents/default';
import researchDefinition from 'src/app-hosts/linnya/agent-registry/agents/research_v1';

// Harness 复用生产 registry / prompt builder / context assembly，仅替换上游模型。
// 未安装知识库的正式 platform 状态不得因 Agent 白名单仍含 KB 名称而重新暴露能力。
describe('Knowledge unavailable in actual model requests', () => {
  let harness: GraphLoopHarness | undefined;
  afterEach(() => { harness?.restore(); harness = undefined; });

  it.each([AGENT_DEFINITION, researchDefinition])('$id 新运行保留文件能力且不发布已停用知识库工具', async definition => {
    harness = createGraphLoopHarness({
      tools: [],
      query: 'Explain the supplied project document; report unavailable sources honestly.',
      requestPatch: {
        promptKey: definition.promptKey,
        enableTools: true,
        availableTools: [...(definition.config?.availableTools ?? [])],
        project_metadata: { id: 'project-knowledge-disabled', name: 'Synthetic project' },
        researchScope: ResearchRunArgsSchema.parse({
          question: 'Explain the supplied project document.', reader: 'General reader',
          task_type: 'open', materials: [],
        }),
      },
      turns: [{ contentChunks: ['Knowledge is unavailable; the supplied file remains usable.'] }],
    });
    const result = await harness.run();
    expect(result.events.some(event => event.type === 'final_answer')).toBe(true);
    const calls = harness.getLlmCalls();
    expect(calls).toHaveLength(1);
    const names = calls[0]?.options.tools?.map(tool => tool.name) ?? [];
    expect(names).toContain('read_file');
    for (const name of ['knowledge_search', 'knowledge_read', 'search_in_knowledgebase', 'list_knowledge_base', 'assemble_documents']) {
      expect(names).not.toContain(name);
    }
    const system = calls[0]?.messages.find(message => message.role === 'system');
    expect(system?.content).toContain('Use Knowledge tools only when they are available in this run');
    expect(system?.content).toContain('If unavailable, report the source limitation');
    expect(system?.content).not.toContain('All the reference documents have been structured');
    harness.assertAllTurnsConsumed();
  });
});
