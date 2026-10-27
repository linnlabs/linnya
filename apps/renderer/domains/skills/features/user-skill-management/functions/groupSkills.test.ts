import { describe, expect, it } from 'vitest';
import type { ManagedSkill } from '@app/schemas';
import { groupSkills } from './groupSkills';

const skill = (name: string, source: ManagedSkill['source']): ManagedSkill =>
  ({ name, description: name, source, available: true, files: ['SKILL.md'] });

describe('groupSkills', () => {
  it('用户 Skill 最前且没有时仍显示，内置与插件按有无内容出现，组内按名称排序', () => {
    const groups = groupSkills([skill('slides-design', 'plugin'), skill('b-builtin', 'builtin'), skill('a-builtin', 'builtin')]);
    expect(groups.map(group => [group.source, group.skills.map(item => item.name)])).toEqual([
      ['user', []], ['builtin', ['a-builtin', 'b-builtin']], ['plugin', ['slides-design']],
    ]);
  });

  it('没有插件 Skill 时不显示空的插件分组', () => {
    expect(groupSkills([skill('mine', 'user')]).map(group => group.source)).toEqual(['user']);
  });
});
