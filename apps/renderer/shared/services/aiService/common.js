/** 通用本地 Backend HTTP 入口；模型用途选择由 app/model-inference 负责。 */
export { apiFetch, getApiBaseUrl, getApiToken, refreshApiSession } from '../localApiClient';
