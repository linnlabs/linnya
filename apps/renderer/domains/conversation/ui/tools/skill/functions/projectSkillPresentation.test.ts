import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectSkillPresentation } from './projectSkillPresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectSkillPresentation({
    sourceToolName: 'skill',
    uiKey: 'skill',
    args: { action: 'activate', skill_name: 'slides-design' },
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

describe('projectSkillPresentation', () => {
  it('生命周期阶段只接纳 skill 参数', () => {
    expect(project({ result: { invalid: true } })).toEqual({
      data: { kind: 'skill', action: 'activate', skillName: 'slides-design' },
    });
  });

  it('三种 skill action 都要求成功结果与参数身份一致', () => {
    expect(
      project({
        status: 'success',
        result: {
          data: {
            skill_name: 'slides-design',
            source: 'plugin',
            activated: true,
            resource_count: 3,
          },
          observation: '<skill_content />',
        },
      }).data
    ).toMatchObject({ action: 'activate', skillName: 'slides-design' });

    expect(
      project({
        args: { action: 'list_resources', skill_name: 'slides-design' },
        status: 'success',
        result: {
          data: { skill_name: 'slides-design', resources: ['references/design.md'] },
          observation: 'resources',
        },
      }).data
    ).toMatchObject({ action: 'list_resources' });

    expect(
      project({
        args: {
          action: 'read_resource',
          skill_name: 'slides-design',
          resource_path: 'references/design.md',
        },
        status: 'success',
        result: {
          data: {
            skill_name: 'slides-design',
            resource_path: 'references/design.md',
            total_lines: 10,
            start_line: 1,
            end_line: 10,
            is_truncated: false,
          },
          observation: '<skill_resource />',
        },
      }).data
    ).toMatchObject({ action: 'read_resource' });
  });

  it('resource_read(skill://) 显式适配 wrapper 结果', () => {
    expect(
      project({
        sourceToolName: 'resource_read',
        uiKey: 'skill_resource_read',
        args: { uri: 'skill://skills/slides-design/references/design.md' },
        status: 'success',
        result: {
          data: {
            skill_name: 'slides-design',
            resource_path: 'references/design.md',
            uri: 'skill://skills/slides-design/references/design.md',
            total_lines: 10,
            start_line: 1,
            end_line: 10,
            next_offset: null,
            is_truncated: false,
            content: 'design guidance',
          },
          observation: '<skill_resource />',
          observationPreviewMeta: { document_name: 'slides-design/references/design.md' },
        },
      })
    ).toEqual({
      data: { kind: 'resource', skillName: 'slides-design' },
    });
  });

  it('拒绝 action、skill identity、resource path 或开放字段分裂', () => {
    expect(() =>
      project({
        status: 'success',
        result: {
          data: { skill_name: 'other', resources: [] },
          observation: 'resources',
        },
      })
    ).toThrow();

    expect(
      project({
        args: { action: 'activate', skill_name: 'slides-design', hidden: true },
      }).data
    ).toEqual({ kind: 'lifecycle' });

    expect(() =>
      project({
        sourceToolName: 'resource_read',
        uiKey: 'skill_resource_read',
        args: { uri: 'unknown://items/not-a-skill' },
        status: 'success',
      })
    ).toThrow('Unsupported Skill resource URI');
  });

  it('resource_read 生命周期不会把尚未成形的 URI 当作成功合同', () => {
    expect(
      project({
        sourceToolName: 'resource_read',
        uiKey: 'skill_resource_read',
        args: { uri: 'unknown://items/not-a-skill' },
      })
    ).toEqual({ data: { kind: 'lifecycle' } });
  });
});

describe('projectSkillPresentation：skill_manage', () => {
  function manage(overrides: Partial<ToolPresentationProjectorInput>) {
    return projectSkillPresentation({
      sourceToolName: 'skill_manage',
      uiKey: 'skill_manage',
      args: { action: 'install', name: 'weekly-report', source_directory: '/tmp/weekly-report' },
      result: undefined,
      status: 'loading',
      phase: 'start',
      ...overrides,
    });
  }

  it('运行中只投影动作与目标，不暴露本机目录', () => {
    expect(manage({}).data).toEqual({ kind: 'manage', action: 'install', skillName: 'weekly-report', path: undefined });
    expect(JSON.stringify(manage({}))).not.toContain('/tmp');
  });

  it('参数尚未成形时退回通用生命周期文案', () => {
    expect(manage({ args: { action: 'install' } }).data).toEqual({ kind: 'lifecycle' });
  });

  it('编辑类动作带上文件路径，list 没有目标 Skill', () => {
    expect(manage({
      args: { action: 'edit', name: 'weekly-report', path: 'SKILL.md', old_string: 'a', new_string: 'b' },
    }).data).toEqual({ kind: 'manage', action: 'edit', skillName: 'weekly-report', path: 'SKILL.md' });
    expect(manage({ args: { action: 'list' } }).data).toEqual({ kind: 'manage', action: 'list', skillName: undefined, path: undefined });
  });

  it('成功结果必须与参数的动作和名称一致', () => {
    const ok = manage({
      status: 'success',
      result: { data: { action: 'install', name: 'weekly-report' }, observation: '{}' },
    });
    expect(ok.data).toMatchObject({ kind: 'manage', action: 'install' });
    expect(() => manage({ status: 'success', result: { data: { action: 'remove', name: 'weekly-report' }, observation: '{}' } })).toThrow();
    expect(() => manage({ status: 'success', result: { data: { action: 'install', name: 'other' }, observation: '{}' } })).toThrow();
  });
});
