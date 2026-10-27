import type { ManagedSkill } from '@app/schemas';

export type SkillGroupSource = ManagedSkill['source'];

export interface SkillGroup {
  readonly source: SkillGroupSource;
  readonly skills: readonly ManagedSkill[];
}

/** 用户自己的 Skill 排最前并且始终显示（空时给出引导）；内置与插件按有无内容显示。 */
const ORDER: readonly SkillGroupSource[] = ['user', 'builtin', 'plugin'];

export function groupSkills(skills: readonly ManagedSkill[]): readonly SkillGroup[] {
  return ORDER
    .map(source => ({
      source,
      skills: skills.filter(skill => skill.source === source).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter(group => group.source === 'user' || group.skills.length > 0);
}
