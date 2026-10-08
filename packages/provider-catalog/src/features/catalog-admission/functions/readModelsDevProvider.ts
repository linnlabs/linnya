import type { ModelsDevProvider } from '../definitions/modelsDevSource';

/** 结构解析后再校验 source 身份与地址观察值，不能让 key/id 分叉进入准入规则。 */
export function readModelsDevProvider(
  provider: ModelsDevProvider | undefined,
  sourceProviderId: string
): ModelsDevProvider {
  if (!provider) {
    throw new Error(`models.dev 缺少已准入 Provider: ${sourceProviderId}`);
  }
  if (provider.id !== sourceProviderId) {
    throw new Error(
      `models.dev Provider key/id 不一致: key=${sourceProviderId}, id=${provider.id}`
    );
  }
  if (provider.api) {
    let parsedApiUrl: URL;
    try {
      parsedApiUrl = new URL(provider.api);
    } catch {
      throw new Error(`models.dev Provider API URL 非法: ${sourceProviderId}`);
    }
    if (parsedApiUrl.protocol !== 'https:' && parsedApiUrl.protocol !== 'http:') {
      throw new Error(`models.dev Provider API 不是 HTTP(S): ${sourceProviderId}`);
    }
  }
  return provider;
}
