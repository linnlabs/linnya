import { apiFetch, getApiBaseUrl } from '@/shared/services/aiService/common';
import type { WorkspaceAssetImagePreviewPort } from '../definitions/workspaceAssetImagePreview';

export function createWorkspaceAssetImagePreviewApi(dependencies: {
  readonly getBaseUrl: () => Promise<string>;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}): WorkspaceAssetImagePreviewPort {
  return {
    async loadImage(assetId, signal) {
      const baseUrl = await dependencies.getBaseUrl();
      const response = await dependencies.fetch(
        `${baseUrl}/api/v1/workspace/assets/images/${encodeURIComponent(assetId)}/content`,
        { headers: { Accept: 'image/*' }, signal },
      );
      if (!response.ok) {
        throw new Error(`Workspace asset image preview failed: HTTP ${response.status}`);
      }
      return response.blob();
    },
  };
}

export const workspaceAssetImagePreviewApi = createWorkspaceAssetImagePreviewApi({
  getBaseUrl: getApiBaseUrl,
  fetch: apiFetch,
});
