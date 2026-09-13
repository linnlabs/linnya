import type { ExportArtifactCommitPort } from '../../../../features/system/export/definitions/exportArtifactCommitPort';
import type { WebPageRenderer } from '../../../../tools/web/webread/definitions/webPageRenderer';
import { WebPageRenderError } from '../../../../tools/web/webread/definitions/webPageRenderer';
import type { ExternalAuthorizationBrowserPort } from '../../application/provider-account-authorization';
import type {
  BackendRendererIntegrationPort,
  DesktopFileRevealPort,
  DesktopHiddenWorkerHostPort,
  DesktopRasterPdfDocumentPort,
  DesktopTextMeasurementWorkerPort,
} from '../../desktop-capabilities';

export class CliRuntimeCapabilityUnavailableError extends Error {
  constructor(readonly capability: string) {
    super(`CLI Runtime 不提供 ${capability}；该操作需要 Linnya Desktop`);
    this.name = 'CliRuntimeCapabilityUnavailableError';
  }
}

function unavailable(capability: string): CliRuntimeCapabilityUnavailableError {
  return new CliRuntimeCapabilityUnavailableError(capability);
}

/** CLI 没有 Renderer；这里消费瞬时展示通知，持久业务事实仍由各自 owner 写入数据库。 */
export function createCliRuntimeRendererIntegrationPort(): BackendRendererIntegrationPort {
  return Object.freeze({
    async connectModelCatalogUpdates() { return () => undefined; },
    publishIngestionStatus() {},
    queueJobPresentationPublisher: Object.freeze({
      publishProgress() {},
      publishCompletion() {},
      publishFailure() {},
    }),
    publishKnowledgeGraphProgress() {},
    publishTranscriptionProgress() {},
    publishWorkspaceMutation() {},
    publishPluginRendererPush() {},
    publishTodosChanged() {},
    publishPluginsChanged() {},
    publishModelsChanged() {},
  });
}

export function createCliRuntimeUnavailableCapabilities(): {
  readonly fileReveal: DesktopFileRevealPort;
  readonly hiddenWorker: DesktopHiddenWorkerHostPort;
  readonly textMeasurement: DesktopTextMeasurementWorkerPort;
  readonly rasterPdf: DesktopRasterPdfDocumentPort;
  readonly externalBrowser: ExternalAuthorizationBrowserPort;
  readonly webPageRenderer: WebPageRenderer;
  readonly exportArtifactCommit: ExportArtifactCommitPort;
} {
  return Object.freeze({
    fileReveal: Object.freeze({
      async revealInFileManager() { throw unavailable('系统文件管理器显示'); },
    }),
    hiddenWorker: Object.freeze({
      async registerHiddenWorker() { throw unavailable('插件隐藏 Chromium worker'); },
      async unregisterHiddenWorker() { throw unavailable('插件隐藏 Chromium worker'); },
      async ensureHiddenWorkerReady() { throw unavailable('插件隐藏 Chromium worker'); },
      touchHiddenWorker() { throw unavailable('插件隐藏 Chromium worker'); },
      async invokeHiddenWorker() { throw unavailable('插件隐藏 Chromium worker'); },
      invalidateHiddenWorker() { throw unavailable('插件隐藏 Chromium worker'); },
    }),
    textMeasurement: Object.freeze({
      availability: Object.freeze({
        available: false,
        reason: 'CLI Runtime 没有 Browser Pretext worker',
      }),
      async measureBatch() { throw unavailable('Browser Pretext 文本测量'); },
      touch() {},
    }),
    rasterPdf: Object.freeze({
      async render() { throw unavailable('Chromium PDF 栅格合成'); },
    }),
    externalBrowser: Object.freeze({
      async open() { throw unavailable('OAuth 系统浏览器授权'); },
    }),
    webPageRenderer: Object.freeze({
      async render() {
        throw new WebPageRenderError('unavailable', 'CLI Runtime 没有 Chromium 网页渲染器');
      },
    }),
    exportArtifactCommit: Object.freeze({
      async commit() { throw unavailable('Desktop 导出目标提交'); },
    }),
  });
}
