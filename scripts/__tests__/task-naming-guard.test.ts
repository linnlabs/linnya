import { describe, expect, it } from 'vitest';

import { findTaskNamingAllowance } from '../guards/task-naming-allowlist';
import {
  collectTaskNamingOccurrencesByExactName,
  findTaskNamingViolations,
} from '../guards/task-naming-guard';

function ruleIds(filePath: string, source: string): string[] {
  return findTaskNamingViolations(filePath, source).map(violation => violation.ruleId);
}

describe('task naming guard', () => {
  it('拦截没有语义允许项的 task 路径和导出标识符', () => {
    expect(
      ruleIds('src/domains/example/features/task/TaskManager.ts', 'export class TaskManager {}')
    ).toEqual(expect.arrayContaining(['TASK-NAMING-01-path', 'TASK-NAMING-02-identifier']));
  });

  it('拦截对象属性和 element access 中的 task wire key', () => {
    const rules = ruleIds(
      'src/domains/example/activityBinding.ts',
      "const metadata = { task: binding }; return metadata['task'];"
    );

    expect(rules).toContain('TASK-NAMING-02-identifier');
    expect(rules).toContain('TASK-NAMING-03-contract-key');
  });

  it('拦截工具名、promptKey 和 availableTools 中的旧运行时名称', () => {
    const rules = ruleIds(
      'src/domains/example/delegation.ts',
      [
        "const toolName = 'task';",
        "const promptKey = 'task_subagent';",
        "const config = { availableTools: ['task'] };",
      ].join('\n')
    );

    expect(rules.filter(rule => rule === 'TASK-NAMING-04-runtime-name')).toHaveLength(3);
  });

  it('拦截 HTML 和现行文档中的已退役契约名', () => {
    expect(
      ruleIds(
        'index.html',
        '"@plugin/renderer/taskToolUi": "plugin://host/plugin-renderer/taskToolUi.js"'
      )
    ).toEqual(['TASK-NAMING-05-deprecated-reference']);
    expect(
      ruleIds(
        'docs/plugins/guides/example.md',
        'Use TaskCard with task_batch and task_sheet_editor.'
      )
    ).toEqual([
      'TASK-NAMING-05-deprecated-reference',
      'TASK-NAMING-05-deprecated-reference',
      'TASK-NAMING-05-deprecated-reference',
    ]);
  });

  it('不扫描归档研究记录中的历史契约名', () => {
    expect(ruleIds('docs/archive/task-migration.md', 'TaskCard used task_batch.')).toEqual([]);
    expect(ruleIds('docs/research-notes/task-migration.md', 'TaskCard used task_batch.')).toEqual(
      []
    );
  });

  it('不把局部变量和普通测试断言当成公共命名', () => {
    expect(
      ruleIds(
        'src/domains/example/executor.test.ts',
        ['const task = queue.next();', "expect(run.kind).toBe('task');"].join('\n')
      )
    ).toEqual([]);
  });

  it('忽略普通注释和自然语言中的 task', () => {
    expect(
      ruleIds(
        'src/domains/example/messages.ts',
        [
          '// task is an ordinary English word here',
          "const message = 'Please complete this task carefully.';",
        ].join('\n')
      )
    ).toEqual([]);
  });

  it('只在 TaskState 业务边界保留 TaskState，并允许标准技术术语', () => {
    expect(
      ruleIds(
        'src/domains/task-state/features/snapshot/definitions/taskStateSnapshot.ts',
        'export interface TaskStateSnapshot {}'
      )
    ).toEqual([]);
    expect(
      ruleIds(
        'src/infra/adapters/task-state/createLegacyTaskStateStore.ts',
        'export function createLegacyTaskStateStore() {}'
      )
    ).toEqual([]);
    expect(
      ruleIds(
        'apps/renderer/domains/conversation/ui/tools/configs/common.ts',
        "export const configs = { 'task_write': {}, 'task_read': {} };"
      )
    ).toEqual([]);
    expect(
      ruleIds(
        'src/tools/agent_control/task/schema.ts',
        [
          'export interface TaskState {}',
          'export function scheduleMicrotask() {}',
          'export function installLongTaskObserver() {}',
        ].join('\n')
      )
    ).toEqual([]);
    expect(
      ruleIds(
        'packages/schemas/src/tools/taskstate.ts',
        'export const TaskStateSchema = {}; export interface TaskState {}'
      )
    ).toEqual([]);

    expect(
      ruleIds(
        'src/infra/task-queue/WorkerThreadQueue.ts',
        'export enum TaskState { PENDING = "pending" }'
      )
    ).toContain('TASK-NAMING-02-identifier');
    expect(
      ruleIds('src/domains/example/taskStateSnapshot.ts', 'export interface TaskStateSnapshot {}')
    ).toEqual(expect.arrayContaining(['TASK-NAMING-01-path', 'TASK-NAMING-02-identifier']));
  });

  it('知识库 Worker 只允许对外 task 协议字段，不放行内部 Task 类型', () => {
    expect(
      ruleIds('src/infra/task-queue/jobs.ts', 'export interface Payload { taskId: string }')
    ).toEqual([]);
    expect(
      ruleIds('src/infra/task-queue/WorkerThreadQueue.ts', 'export interface Task {}')
    ).toContain('TASK-NAMING-02-identifier');
  });

  it('只保留云模型 task_defaults wire key，不放行辅助模型内部 task 类型', () => {
    expect(
      ruleIds(
        'src/domains/model-catalog/features/cloud-catalog/orchestration/fetchCloudModels.ts',
        'interface CloudResponse { task_defaults?: Record<string, string> }'
      )
    ).toEqual([]);
    expect(
      ruleIds(
        'apps/renderer/domains/settings/definitions/auxiliaryModelPurposes.ts',
        'export interface AuxiliaryModelTaskDefinition {}'
      )
    ).toContain('TASK-NAMING-02-identifier');
  });

  it('真实云模型客户端边界中的 task_defaults 都由精确长期允许项解释', () => {
    const occurrences = collectTaskNamingOccurrencesByExactName('task_defaults');

    expect(occurrences.length).toBeGreaterThan(0);
    expect(
      occurrences.every(
        occurrence => findTaskNamingAllowance(occurrence)?.id === 'cloud-model-task-defaults-wire'
      )
    ).toBe(true);
  });

  it('只允许插件 AgentDefinition.task 字段，不放行旧 promptKey', () => {
    const pluginAgentPath = 'packages/plugins/example/src/backend/agents/subagent_example/index.ts';

    expect(
      ruleIds(pluginAgentPath, 'export const definition = { task: { systemPromptBuilder() {} } };')
    ).toEqual([]);
    expect(
      ruleIds(
        pluginAgentPath,
        [
          "export const TASK_SUBAGENT = 'task_subagent';",
          "export const definition = { promptKey: 'task_subagent' };",
        ].join('\n')
      )
    ).toEqual(expect.arrayContaining(['TASK-NAMING-02-identifier', 'TASK-NAMING-04-runtime-name']));
  });
});
