import {
  isAuxiliaryModelPurposeKey,
  readEffectiveAuxiliaryModelPurposeBinding,
  readEffectiveModelPurposeBinding,
} from '@/domains/model-configuration';

export {
  apiFetch,
  getApiBaseUrl,
  getApiToken,
  refreshApiSession,
} from '../localApiClient';

// Helper function to determine which model ID to use
export function determineModelId(prompt_key) {
  const purposeKey = typeof prompt_key === 'string' ? prompt_key : 'default';
  const isAuxiliaryPurpose = isAuxiliaryModelPurposeKey(purposeKey);

  if (isAuxiliaryPurpose) {
    return readEffectiveAuxiliaryModelPurposeBinding(purposeKey);
  }

  return readEffectiveModelPurposeBinding('primary');
}

// 你可以在这里添加其他可能被多个AI服务文件共享的通用函数或常量
// 例如，通用的错误处理函数、请求头构造函数等。
