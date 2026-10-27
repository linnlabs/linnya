/** 持有这个工具即具备维护用户 Skill 的能力，由 Agent 定义的工具名单决定，不按 Agent 身份硬编码。 */
export const SKILL_AUTHORING_TOOL = 'skill_manage';

/** 内置 skill-creator 只向持有 skill_manage 的 Agent 暴露：它的全部指引都围绕这个工具。 */
export const SKILL_AUTHORING_SKILL = 'skill-creator';

export function toolListGrantsSkillAuthoring(tools: readonly string[] | undefined): boolean {
  return tools?.includes(SKILL_AUTHORING_TOOL) === true;
}

/** 运行时判断以 Host 冻结的名单为准：子运行用自己的名单，根运行用根名单。 */
export function contextGrantsSkillAuthoring(context: {
  readonly registeredRootAllowedTools?: readonly string[];
  readonly registeredChildAllowedTools?: readonly string[];
}): boolean {
  return toolListGrantsSkillAuthoring(context.registeredChildAllowedTools ?? context.registeredRootAllowedTools);
}
