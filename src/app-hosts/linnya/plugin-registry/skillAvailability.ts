/**
 * @file skillAvailability.ts
 * @description 将插件运行态接入 Skill 可用性规则。
 *
 * 中文说明：
 * - Skill 本身只通过 frontmatter.metadata.pluginId 声明归属；
 * - 是否可见由 app host 读取插件运行态决定；
 * - 具体插件统一复用同一套 skill 门禁。
 */

import { registerSkillAvailabilityRule } from '../../../features/skills/availability';
import { isPluginRuntimeEnabled } from './pluginRuntimeState';

let registered = false;

export function ensurePluginSkillAvailabilityRegistered(): void {
  if (registered) return;
  registerSkillAvailabilityRule('linnya-plugin-runtime', (skill) => {
    const pluginId = skill.metadata?.pluginId;
    if (!pluginId) return true;
    return isPluginRuntimeEnabled(pluginId);
  });
  registered = true;
}
