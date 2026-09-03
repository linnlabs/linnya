import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SubagentResultSchema,
  WorkspaceReadFileResultSchema,
  formatWorkspaceFileLocator,
} from '@app/schemas';
import { expectMessagesContainText, expectToolOutputFedBackToHistory } from '@linnlabs/linnkit/testkit';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import {
  createChildRunHarness,
  type ChildRunHarness,
} from 'src/app-hosts/linnya/testkit/agent-harness/childRunHarness';
import { ReadFileTool } from 'src/tools/workspace/read_file/ReadFileTool';
import { WriteFileTool } from 'src/tools/workspace/write_file/WriteFileTool';
import { SubagentTool } from '../subagentTool';
import {
  createSubagentWorkspaceTestFixture,
  type SubagentWorkspaceTestFixture,
} from './subagentWorkspaceTestHarness';

const DOCUMENT_LOCATOR = formatWorkspaceFileLocator('/subagent-findings.md');

const { TEST_GENERAL_DEFINITION } = vi.hoisted(() => ({
  TEST_GENERAL_DEFINITION: {
    id: 'subagent_general_workspace_test',
    promptKey: 'subagent_general',
    defaultMode: 'agent',
    description: '测试通用子 Agent 的 Workspace 协作',
    config: {
      enableTools: true,
      availableTools: ['write_file'],
    },
    task: {
      systemPromptBuilder: () => '你是一个测试用通用子 Agent。',
    },
  } satisfies AgentDefinition,
}));

vi.mock('src/app-hosts/linnya/agent-registry/agents', () => ({
  ALL_AGENT_DEFINITIONS_FOR_TESTS: [TEST_GENERAL_DEFINITION],
}));

describe('SubagentTool Workspace 集成', () => {
  let childRunHarness: ChildRunHarness | undefined;
  let fixture: SubagentWorkspaceTestFixture | undefined;

  afterEach(() => {
    childRunHarness?.restore();
    childRunHarness = undefined;
    fixture?.dispose();
    fixture = undefined;
  });

  it('通用子 Agent 应通过真实 write_file 落盘并向父 Agent 返回 Workspace inode', async () => {
    childRunHarness = createChildRunHarness({
      agentDefinitions: [TEST_GENERAL_DEFINITION],
      tools: [new WriteFileTool()],
      turns: [
        {
          toolCalls: [
            {
              id: 'subagent_write_call_1',
              name: 'write_file',
              argumentsJson: JSON.stringify({
                locator: DOCUMENT_LOCATOR,
                content: '# Subagent Findings\n\n- 发现 A\n- 发现 B',
              }),
            },
          ],
          assertCall: call => expectMessagesContainText(call, '请产出一份 findings'),
        },
        {
          contentChunks: ['子 Agent 已完成，研究结果已经写入项目文档。'],
          assertCall: call => {
            expectToolOutputFedBackToHistory(call, '已创建 Markdown 文件');
            expectToolOutputFedBackToHistory(call, 'workspace:');
          },
        },
      ],
    });
    fixture = createSubagentWorkspaceTestFixture();
    const context = fixture.createContext({
      conversationId: 'conv_subagent_workspace_integration',
      patch: {
        modelId: 'scripted-test-model',
        runId: RunIdSchema.parse('run_subagent_workspace_parent'),
        parentToolCallId: ToolCallIdSchema.parse('call_subagent_workspace'),
        createSubRunTracePublisher: () => ({ publish: vi.fn() }),
        registeredChildRunInvoker: childRunHarness.invoker,
      },
    });

    const output = SubagentResultSchema.parse(
      JSON.parse(
        await new SubagentTool().run(
          {
            description: '测试 Workspace 子流程',
            prompt: '请产出一份 findings',
            subagent_type: 'general',
          },
          context
        )
      )
    );

    expect(output.data.status).toBe('completed');
    expect(output.data.artifacts).toHaveLength(1);
    const readResult = WorkspaceReadFileResultSchema.parse(
      JSON.parse(await new ReadFileTool().run({ locator: DOCUMENT_LOCATOR }, context))
    );
    expect(readResult.observation).toContain('发现 A');
    childRunHarness.assertAllTurnsConsumed();
  });
});
