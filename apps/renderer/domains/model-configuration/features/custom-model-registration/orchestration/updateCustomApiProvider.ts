import { normalizeCustomApiBaseUrl } from '@app/schemas/custom-api-onboarding';

import type {
  CustomApiProviderEditForm,
  CustomApiProviderEditGateway,
  CustomApiProviderEditResult,
} from '../definitions/customApiProviderEdit';
import { httpCustomApiProviderEditGateway } from '../infrastructure/httpCustomApiProviderEditGateway';

/**
 * 提交一个自定义模型分组的连接编辑。
 *
 * 只校验用户输入并交给 Host；endpoint 复用、凭据沿用与 route 重建全部由 Host use case 决定。
 */
export async function updateCustomApiProvider(
  currentProviderName: string,
  form: Readonly<CustomApiProviderEditForm>,
  gateway: CustomApiProviderEditGateway = httpCustomApiProviderEditGateway
): Promise<CustomApiProviderEditResult> {
  const providerName = form.providerName.trim();
  if (!providerName) return { ok: false, issue: 'provider_name_required' };
  const baseUrl = normalizeCustomApiBaseUrl(form.customApiFormat, form.baseUrl);
  if (!baseUrl) return { ok: false, issue: 'base_url_invalid' };
  const apiKey = form.credentialSecret.trim();

  await gateway.updateProvider({
    current_provider_name: currentProviderName,
    provider_name: providerName,
    api_format: form.customApiFormat,
    base_url: baseUrl,
    ...(apiKey ? { api_key: apiKey } : {}),
  });
  return { ok: true };
}
