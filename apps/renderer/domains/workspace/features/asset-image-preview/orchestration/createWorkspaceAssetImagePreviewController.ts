import type {
  WorkspaceAssetImagePreviewCandidate,
  WorkspaceAssetImagePreviewController,
  WorkspaceAssetImagePreviewPort,
  WorkspaceAssetImagePreviewState,
} from '../definitions/workspaceAssetImagePreview';

interface PreviewRuntime {
  readonly abortController: AbortController;
  objectUrl?: string;
}

const EMPTY_PREVIEW: WorkspaceAssetImagePreviewState = {
  visible: false,
  loading: false,
  src: '',
  name: '',
  error: '',
};

export function createWorkspaceAssetImagePreviewController(dependencies: {
  readonly api: WorkspaceAssetImagePreviewPort;
  readonly state: { replace(value: WorkspaceAssetImagePreviewState): void };
  readonly mediaUrls: { buildImageUrl(filePath: string): string };
  readonly objectUrls: { create(blob: Blob): string; revoke(url: string): void };
}): WorkspaceAssetImagePreviewController {
  let activeRuntime: PreviewRuntime | null = null;
  let activeName: string | null = null;

  function disposeRuntime(): void {
    const runtime = activeRuntime;
    activeRuntime = null;
    if (!runtime) return;
    runtime.abortController.abort();
    if (runtime.objectUrl) dependencies.objectUrls.revoke(runtime.objectUrl);
  }

  function publishError(name: string, message: string): void {
    dependencies.state.replace({
      visible: true,
      loading: false,
      src: '',
      name,
      error: message,
    });
  }

  async function open(candidate: WorkspaceAssetImagePreviewCandidate): Promise<void> {
    disposeRuntime();
    activeName = candidate.name;
    dependencies.state.replace({
      visible: true,
      loading: true,
      src: '',
      name: candidate.name,
      error: '',
    });

    let requestRuntime: PreviewRuntime | null = null;
    try {
      let src: string;
      if (candidate.assetId) {
        // 受管资产必须按 durable identity 读取；filePath 只服务历史非账本图片。
        const runtime: PreviewRuntime = { abortController: new AbortController() };
        requestRuntime = runtime;
        activeRuntime = runtime;
        const blob = await dependencies.api.loadImage(candidate.assetId, runtime.abortController.signal);
        if (activeRuntime !== runtime) return;
        runtime.objectUrl = dependencies.objectUrls.create(blob);
        src = runtime.objectUrl;
      } else if (candidate.filePath) {
        src = dependencies.mediaUrls.buildImageUrl(candidate.filePath);
      } else if (candidate.remoteUri && /^https?:\/\//i.test(candidate.remoteUri)) {
        src = candidate.remoteUri;
      } else {
        throw new Error('workspace_asset_image_preview_source_missing');
      }

      dependencies.state.replace({
        visible: true,
        loading: false,
        src,
        name: candidate.name,
        error: '',
      });
    } catch (error: unknown) {
      if (requestRuntime?.abortController.signal.aborted) return;
      console.error('[WorkspaceAssetImagePreview] 图片预览加载失败:', error);
      disposeRuntime();
      publishError(candidate.name, candidate.loadErrorMessage);
    }
  }

  function close(): void {
    disposeRuntime();
    activeName = null;
    dependencies.state.replace(EMPTY_PREVIEW);
  }

  return {
    open,
    handleImageLoadError(message) {
      if (!activeName) return;
      disposeRuntime();
      publishError(activeName, message);
    },
    close,
    dispose: close,
  };
}
