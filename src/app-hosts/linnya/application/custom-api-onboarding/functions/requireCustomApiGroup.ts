import type { CustomApiGroup } from 'src/domains/model-catalog';
import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';

/** 连接的存在与模型数量无关；空分组仍可以刷新、编辑和显式删除。 */
export function requireCustomApiGroup(
  name: string,
  groups: readonly CustomApiGroup[]
): CustomApiGroup {
  const group = groups.find(candidate => candidate.name === name);
  if (!group)
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.provider_not_found',
      '自定义模型分组不存在或已被删除',
      404
    );
  return group;
}
