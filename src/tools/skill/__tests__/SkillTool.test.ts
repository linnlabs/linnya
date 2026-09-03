import { afterEach, describe, expect, it, vi } from 'vitest';

import { SkillTool } from '../SkillTool';
import * as skillCatalog from '../../../features/skills/catalog';

describe('SkillTool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('read_resource 应按 offset/limit 返回行窗口，避免续读重复返回资源开头', async () => {
    vi.spyOn(skillCatalog, 'readSkillResource').mockReturnValue(
      ['# Reference', '', 'Line 3', 'Line 4', 'Line 5'].join('\n')
    );

    const tool = new SkillTool();
    const out = await tool.run(
      {
        action: 'read_resource',
        skill_name: 'slides-design',
        resource_path: 'references/api-reference.md',
        offset: 3,
        limit: 2,
      },
      {}
    );

    const parsed = JSON.parse(out) as {
      data: Record<string, unknown>;
      observation: string;
    };

    expect(parsed.data.start_line).toBe(3);
    expect(parsed.data.end_line).toBe(4);
    expect(parsed.data.total_lines).toBe(5);
    expect(parsed.observation).toContain('lines="3-4" total_lines="5"');
    expect(parsed.observation).toContain('Line 3\nLine 4');
    expect(parsed.observation).not.toContain('# Reference');
  });

  it('activate 输出 Skill 自持的资源读取动作，不生成 skill URI', async () => {
    vi.spyOn(skillCatalog, 'loadSkillContent').mockReturnValue({
      name: 'slides-design',
      source: 'builtin',
      body: '# Slides',
      resources: ['references/api-reference.md'],
    });

    const tool = new SkillTool();
    const out = await tool.run({
      action: 'activate',
      skill_name: 'slides-design',
    }, {});

    const parsed = JSON.parse(out) as { observation: string };
    expect(parsed.observation).toContain('skill(action="read_resource"');
    expect(parsed.observation).toContain('references/api-reference.md');
    expect(parsed.observation).not.toContain('skill://skills/');
    expect(parsed.observation).not.toContain('resource_read');
  });

  it('owner admission 与 SkillArgsSchema 同源拒绝空资源路径', () => {
    const tool = new SkillTool();
    const validation = tool['validateArguments']({
      action: 'read_resource',
      skill_name: 'slides-design',
      resource_path: '',
    });

    expect(validation.success).toBe(false);
    expect(tool.parameters.properties.skill_name.minLength).toBe(1);
    expect(tool.parameters.properties.resource_path.minLength).toBe(1);
  });
});
