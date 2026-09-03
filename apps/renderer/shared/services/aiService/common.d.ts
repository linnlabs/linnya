export {
  apiFetch,
  getApiBaseUrl,
  getApiToken,
  refreshApiSession,
} from '../localApiClient';

export function determineModelId(prompt_key: string): string | null;
