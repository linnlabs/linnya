import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRunPermissionSnapshotV1Schema } from '@app/schemas/commands';
import { PromptKeys } from '@app/schemas';
import type { ToolContext } from '../../types';

const fixture = vi.hoisted(() => ({ root: '' }));
vi.mock('../../../shared/utils/pathManager', () => ({ getSkillsPath: () => path.join(fixture.root, 'user'), getProjectRoot: () => process.cwd() }));
import { SkillManageTool } from '../SkillManageTool';
import { discoverSkills, invalidateSkillCache } from '../../../features/skills/discovery';

function context(level: 'read_only' | 'standard' | 'full_access', agent = PromptKeys.DEFAULT): ToolContext {
  return { callerAgentId: agent, commandRunPermission: { status: 'available', snapshot: CommandRunPermissionSnapshotV1Schema.parse({
    protocol_version: 1, kind: 'command_run_permission_snapshot', root_agent_run_id: 'skill-test-run',
    settings_revision: 0, captured_at_ms: 1, permission_level: level, internal_data_access: 'allowed',
    gui_control: 'denied', local_ipc_control: 'denied', process_lifecycle: 'terminate_with_run',
  }) } };
}

beforeEach(() => { fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-skill-agent-')); invalidateSkillCache(); });
afterEach(() => { fs.rmSync(fixture.root, { recursive: true, force: true }); invalidateSkillCache(); });

describe('Agent skill write permissions and lifecycle', () => {
  it('Default standard/full_access 调用同一当前文件 owner 完成完整流程', async () => {
    const draft = path.join(fixture.root, 'draft'); fs.mkdirSync(draft);
    fs.writeFileSync(path.join(draft, 'SKILL.md'), '---\nname: agent-fixture\ndescription: test fixture\n---\nBefore\n');
    const tool = new SkillManageTool();
    const std = context('standard');
    await tool.run({ action: 'install', name: 'agent-fixture', source_directory: draft }, std);
    await tool.run({ action: 'edit', name: 'agent-fixture', path: 'SKILL.md', old_string: 'Before', new_string: 'After' }, std);
    expect(fs.readFileSync(path.join(fixture.root, 'user/agent-fixture/SKILL.md'), 'utf8')).toContain('After');
    await tool.run({ action: 'write', name: 'agent-fixture', path: 'references/new.txt', content: 'support' }, std);
    await tool.run({ action: 'update', name: 'agent-fixture', source_directory: draft }, context('full_access'));
    expect(fs.existsSync(path.join(fixture.root, 'user/agent-fixture/references/new.txt'))).toBe(false);
    await tool.run({ action: 'remove', name: 'agent-fixture' }, std);
    expect(fs.readdirSync(path.join(fixture.root, 'user'))).toEqual([]);
  });
  it('外部修改立即进入新目录，坏文件不会拖垮其他 Skill', async () => {
    const user = path.join(fixture.root, 'user'); fs.mkdirSync(user);
    const good = path.join(user, 'good-skill'); fs.mkdirSync(good);
    const file = path.join(good, 'SKILL.md');
    fs.writeFileSync(file, '---\nname: good-skill\ndescription: First description\n---\nBody');
    expect(discoverSkills().find(skill => skill.name === 'good-skill')?.description).toBe('First description');
    fs.writeFileSync(file, '---\nname: good-skill\ndescription: Changed outside the app\n---\nBody');
    const bad = path.join(user, 'broken-skill'); fs.mkdirSync(bad);
    fs.writeFileSync(path.join(bad, 'SKILL.md'), '---\nname: broken-skill\ndescription: Broken resource\n---\nBody');
    fs.writeFileSync(path.join(bad, 'oversized.txt'), 'x'.repeat(600 * 1024));
    const catalog = discoverSkills();
    expect(catalog.find(skill => skill.name === 'good-skill')?.description).toBe('Changed outside the app');
    expect(catalog.some(skill => skill.name === 'broken-skill')).toBe(false);
  });
  it('read_only、缺失冻结权限及非 Default 不能写入', async () => {
    const tool = new SkillManageTool();
    const request = { action: 'remove', name: 'anything' };
    await expect(tool.run(request, context('read_only'))).rejects.toThrow('只读');
    await expect(tool.run(request, { callerAgentId: PromptKeys.DEFAULT })).rejects.toThrow('权限不可用');
    await expect(tool.run(request, { callerAgentId: 'research_v1' })).rejects.toThrow('Default');
    expect(fs.existsSync(path.join(fixture.root, 'user'))).toBe(false);
  });
});
