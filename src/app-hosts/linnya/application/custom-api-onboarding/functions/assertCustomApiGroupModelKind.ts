import {
  readCustomCapabilityFormatForProfile,
  type CustomCapabilityApiFormat,
} from '@app/schemas/custom-api-onboarding';
import type { CustomApiGroup, InferenceEndpointView } from 'src/domains/model-catalog';
import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';

/** 一条可编辑连接不能混合不同的业务协议，避免分组改地址时把其他类型的 route 改坏。 */
export function assertCustomApiGroupModelKind(
  groupName: string,
  capabilityFormat: CustomCapabilityApiFormat | undefined,
  groups: readonly CustomApiGroup[],
  endpoints: readonly InferenceEndpointView[]
): void {
  const group = groups.find(item => item.name === groupName);
  if (!group) return;
  for (const id of group.inference_endpoint_ids) {
    const endpoint = endpoints.find(item => item.id === id);
    if (
      !endpoint ||
      readCustomCapabilityFormatForProfile(endpoint.route_profile_id) !== capabilityFormat
    ) {
      throw new CustomApiOnboardingError(
        'custom_api_onboarding.provider_name_conflict',
        '此连接名称已用于其他接口格式，请使用不同的连接名称',
        409
      );
    }
  }
}
