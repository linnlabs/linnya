/**
 * Slides API 服务
 *
 * 与后端 Slides 插件 IPC 通信的唯一出口。
 */

import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { onRendererPluginPush } from '@plugin/renderer/pluginPushClient';
import {
  SLIDES_IPC,
  SLIDES_PLUGIN_ID,
  SLIDES_PUSH_EVENTS,
  type OperationResult,
  type SlidesIpcChannel,
} from '@plugin/slides/shared/ipc';
import type {
  PresentationImageExportProgress,
  PresentationExportRequest,
  PresentationExportResult,
} from '@plugin/slides/shared/presentationExport';
import { parsePresentationImageExportProgress } from '@plugin/slides/shared/presentationExport';
import type {
  DeckPreview,
  PresentationInfo,
  SlidesDocumentBuildState,
  PptSourceSliceTargetInput,
  PptSourceSlicesOutput,
  TemplateSummary,
  TemplateSpec,
} from '../types/api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unwrapSlidesIpcResult<T>(
  result: OperationResult<T>,
  channel: SlidesIpcChannel,
): T {
  if (!result.success) {
    throw new Error(result.error);
  }
  if (result.data === undefined) {
    throw new Error(`[slidesApi] ${channel} returned no data.`);
  }
  return result.data;
}

async function invokeSlidesIpc<T>(channel: SlidesIpcChannel, payload: unknown): Promise<T> {
  const result = await invokeRendererPluginIpc<T>(SLIDES_PLUGIN_ID, channel, payload);
  return unwrapSlidesIpcResult(result, channel);
}

function readPresentationExportResult(value: unknown): PresentationExportResult {
  if (!isRecord(value)) {
    throw new Error('[slidesApi] slides:export returned invalid data.');
  }
  if (
    value.format !== 'pptx'
    && value.format !== 'images'
    && value.format !== 'pdf'
  ) {
    throw new Error('[slidesApi] slides:export returned invalid format.');
  }
  if (typeof value.fileName !== 'string' || value.fileName.length === 0) {
    throw new Error('[slidesApi] slides:export returned invalid fileName.');
  }
  if (typeof value.byteLength !== 'number' || !Number.isFinite(value.byteLength)) {
    throw new Error('[slidesApi] slides:export returned invalid byteLength.');
  }
  return {
    format: value.format,
    fileName: value.fileName,
    byteLength: value.byteLength,
  };
}

export const slidesApi = {
  /** 获取 Deck 预览数据 */
  async getDeckPreview(nodeId: string): Promise<DeckPreview> {
    return invokeSlidesIpc<DeckPreview>(SLIDES_IPC.preview, { nodeId });
  },

  /** 获取源码与可渲染物化之间的正式状态。 */
  async getDocumentBuildState(nodeId: string): Promise<SlidesDocumentBuildState> {
    return invokeSlidesIpc<SlidesDocumentBuildState>(SLIDES_IPC.buildState, { nodeId });
  },

  /** 解析 PPTX 结构（inspect） */
  async inspect(nodeId: string): Promise<PresentationInfo> {
    return invokeSlidesIpc<PresentationInfo>(SLIDES_IPC.inspect, { nodeId });
  },

  async readSourceSlicesForAiEdit(input: {
    nodeId: string;
    conversationId: string;
    targets: PptSourceSliceTargetInput[];
  }): Promise<PptSourceSlicesOutput> {
    return invokeSlidesIpc<PptSourceSlicesOutput>(SLIDES_IPC.sourceSlices, {
      nodeId: input.nodeId,
      conversationId: input.conversationId,
      targets: input.targets,
    });
  },

  /** Backend 直接把 artifact 写入 Host target；renderer 不再接收完整 bytes。 */
  async exportPresentation(
    request: PresentationExportRequest,
  ): Promise<PresentationExportResult> {
    return readPresentationExportResult(
      await invokeSlidesIpc<unknown>(SLIDES_IPC.export, request),
    );
  },

  onPresentationImageExportProgress(
    callback: (progress: PresentationImageExportProgress) => void,
  ): () => void {
    return onRendererPluginPush(
      SLIDES_PLUGIN_ID,
      SLIDES_PUSH_EVENTS.imageExportProgress,
      payload => callback(parsePresentationImageExportProgress(payload)),
    );
  },

  /** 列出所有模板 */
  async listTemplates(): Promise<TemplateSummary[]> {
    return invokeSlidesIpc<TemplateSummary[]>(SLIDES_IPC.templatesList, {});
  },

  /** 导入模板（通过 plugin IPC 传输 ArrayBuffer） */
  async importTemplate(
    file: File,
    name: string,
    description?: string,
  ): Promise<TemplateSpec> {
    return invokeSlidesIpc<TemplateSpec>(SLIDES_IPC.templateImport, {
      fileName: file.name,
      name,
      ...(description ? { description } : {}),
      buffer: await file.arrayBuffer(),
    });
  },
};
