import {
  readCustomApiFormatRouteProfileId,
  type CustomApiFormat,
} from '@app/schemas/custom-api-onboarding';

import type { CustomApiRuntimeBinding } from '../definitions/customApiRuntimeBinding';

const CUSTOM_API_RUNTIME_BINDINGS = {
  openai_compatible: {
    api_format: 'openai_compatible',
    route_profile_id: readCustomApiFormatRouteProfileId('openai_compatible'),
    endpoint_id: 'custom-openai-compatible',
    auth_profile: 'bearer',
  },
  openai_responses: {
    api_format: 'openai_responses',
    route_profile_id: readCustomApiFormatRouteProfileId('openai_responses'),
    endpoint_id: 'custom-openai-responses',
    auth_profile: 'bearer',
  },
  anthropic_compatible: {
    api_format: 'anthropic_compatible',
    route_profile_id: readCustomApiFormatRouteProfileId('anthropic_compatible'),
    endpoint_id: 'custom-anthropic-compatible',
    auth_profile: 'api_key',
  },
} as const satisfies Record<CustomApiFormat, CustomApiRuntimeBinding>;

/** 自定义 API 格式到内部 runtime route 的唯一 Host 映射。 */
export function readCustomApiRuntimeBinding(format: CustomApiFormat): CustomApiRuntimeBinding {
  return CUSTOM_API_RUNTIME_BINDINGS[format];
}
