/**
 * @file src/tools/skill/index.ts
 * @description Skill 工具模块导出
 */

import { SkillTool } from './SkillTool';
import { SkillManageTool } from './SkillManageTool';

export { SkillTool, SkillManageTool };

export const skillToolClasses = [SkillTool, SkillManageTool] as const;
