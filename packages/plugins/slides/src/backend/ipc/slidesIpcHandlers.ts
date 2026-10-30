import { SlidesIpcError } from '@plugin/slides/shared/ipc';
import type { SlidesInsertedObject, SlidesImportedImage } from '@plugin/slides/shared/authoringEditing';
import { ViewReadRequestSchema, type ViewReadRequest, type ViewReadResponse } from '@plugin/slides/shared/presentationViewSnapshot';
import type {
  DeckPreview,
  PresentationInfo,
  PresentationRenderModel,
  SlidesSourceSliceTargetInput,
  SlidesSourceSlicesOutput,
  SlidesDocumentBuildState,
  TemplateSpec,
  TemplateSummary,
  PresentationExportRequest,
  PresentationExportResult,
  SlidesManualEditCommand,
  SlidesManualEditHistoryStatus,
  SlidesManualEditCommandResult,
} from '@plugin/slides/shared';
import { z } from 'zod';
import {
  parseSlidesNodePayload,
  parseSlidesManualEditPayload,
  parsePresentationExportRequest,
  parseSlidesSourceSlicesPayload,
  parseSlidesTemplateImportPayload,
  readSlidesIpcErrorMessage,
  SLIDES_IPC_CHANNELS,
  SLIDES_PLUGIN_ID,
  type OperationResult,
  type SlidesIpcChannel,
} from './contracts';

export interface SlidesSourceSlicesForAiEditInput {
  readonly presentationId: string;
  readonly conversationId: string;
  readonly targets: SlidesSourceSliceTargetInput[];
}

export interface SlidesIpcCoordinatorPort {
  copyObjects(input: { documentId: string; revisionId: string; targets: readonly { slideKey: string; editKey: string }[] }): Promise<readonly SlidesInsertedObject[]>;
  importImage(documentId: string, bytes: Uint8Array): Promise<SlidesImportedImage>;
  readViewSnapshot(request: ViewReadRequest): Promise<ViewReadResponse>;
  readonly history?: { preview(documentId: string, versionId: string): Promise<PresentationRenderModel> };
  readSourceSlicesForAiEdit(input: SlidesSourceSlicesForAiEditInput): Promise<SlidesSourceSlicesOutput>;
  inspect(nodeId: string): Promise<PresentationInfo>;
  getPreview(nodeId: string): Promise<DeckPreview>;
  getDocumentBuildState(nodeId: string): Promise<SlidesDocumentBuildState>;
  getRenderModel(nodeId: string): Promise<PresentationRenderModel>;
  listTemplates(): Promise<TemplateSummary[]>;
  importTemplate(buffer: Buffer, name: string, description?: string): Promise<TemplateSpec>;
  exportPresentation(request: PresentationExportRequest): Promise<PresentationExportResult>;
  readManualEditHistory(documentId: string): Promise<SlidesManualEditHistoryStatus>;
  submitManualEdit(command: SlidesManualEditCommand): Promise<SlidesManualEditCommandResult>;
}

export type SlidesIpcDataHandler<T> = (payload: unknown) => Promise<T> | T;

export type SlidesBackendIpcHandler = (
  event: unknown,
  payload: unknown
) => Promise<unknown> | unknown;

export type SlidesBackendIpcRegistrar = (
  pluginId: string,
  channel: string,
  handler: SlidesBackendIpcHandler
) => void;

export type SlidesIpcCoordinatorProvider = () => SlidesIpcCoordinatorPort;

function toOperationResult<T>(data: T): OperationResult<T> {
  return { success: true, data };
}

function registerSlidesResultHandler<T>(
  registerBackendPluginIpcHandler: SlidesBackendIpcRegistrar,
  channel: SlidesIpcChannel,
  handler: SlidesIpcDataHandler<T>,
): void {
  registerBackendPluginIpcHandler(
    SLIDES_PLUGIN_ID,
    channel,
    async (_event, payload): Promise<OperationResult<T>> => {
      try {
        return toOperationResult(await handler(payload));
      } catch (error) {
        return {
          success: false,
          error: readSlidesIpcErrorMessage(error),
          code: error instanceof SlidesIpcError ? error.code : error instanceof z.ZodError ? 'validation' : 'internal',
          retryable: error instanceof SlidesIpcError && error.retryable,
        };
      }
    },
  );
}

export function registerSlidesIpcHandlersForCoordinator(
  coordinator: SlidesIpcCoordinatorPort,
  registerBackendPluginIpcHandler: SlidesBackendIpcRegistrar,
): void {
  registerSlidesIpcHandlersForCoordinatorProvider(() => coordinator, registerBackendPluginIpcHandler);
}

export function registerSlidesIpcHandlersForCoordinatorProvider(
  readCoordinator: SlidesIpcCoordinatorProvider,
  registerBackendPluginIpcHandler: SlidesBackendIpcRegistrar,
): void {
  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:history-preview', async payload => {
    const request = z.object({ documentId: z.string().min(1), versionId: z.string().min(1) }).strict().parse(payload);
    const history = readCoordinator().history;
    if (!history) throw new Error('Slides history is unavailable');
    return history.preview(request.documentId, request.versionId);
  });
  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:source-slices', async (payload) => {
    const parsed = parseSlidesSourceSlicesPayload(payload);
    return readCoordinator().readSourceSlicesForAiEdit({
      presentationId: parsed.nodeId,
      conversationId: parsed.conversationId,
      targets: parsed.targets,
    });
  });

  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:inspect', async (payload) => {
    const { nodeId } = parseSlidesNodePayload(payload, 'slides:inspect');
    return readCoordinator().inspect(nodeId);
  });

  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:preview', async (payload) => {
    const { nodeId } = parseSlidesNodePayload(payload, 'slides:preview');
    return readCoordinator().getPreview(nodeId);
  });

  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:build-state', async (payload) => {
    const { nodeId } = parseSlidesNodePayload(payload, 'slides:build-state');
    return readCoordinator().getDocumentBuildState(nodeId);
  });

  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:render-model', async (payload) => {
    const { nodeId } = parseSlidesNodePayload(payload, 'slides:render-model');
    return readCoordinator().getRenderModel(nodeId);
  });

  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:view-snapshot', payload =>
    readCoordinator().readViewSnapshot(ViewReadRequestSchema.parse(payload)));

  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:copy-objects', payload => {
    const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u);
    const input = z.object({ documentId: z.string().min(1), revisionId: z.string().min(1), targets: z.array(z.object({ slideKey: key, editKey: key }).strict()).min(1).max(1000) }).strict().parse(payload);
    return readCoordinator().copyObjects(input);
  });

  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:import-image', async payload => {
    const input = z.object({ documentId: z.string().min(1), base64: z.string().min(4).max(28 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+=*$/u) }).strict().parse(payload);
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.toString('base64') !== input.base64) throw new Error('图片数据不是有效的 base64。');
    return readCoordinator().importImage(input.documentId, bytes);
  });

  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:manual-edit-history', payload => {
    const { nodeId } = parseSlidesNodePayload(payload, 'slides:manual-edit-history');
    return readCoordinator().readManualEditHistory(nodeId);
  });

  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:manual-edit', async (payload) => {
    return readCoordinator().submitManualEdit(parseSlidesManualEditPayload(payload));
  });

  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:templates-list', async () => {
    return readCoordinator().listTemplates();
  });

  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:template-import', async (payload) => {
    const parsed = parseSlidesTemplateImportPayload(payload);
    return readCoordinator().importTemplate(parsed.buffer, parsed.name, parsed.description);
  });

  registerSlidesResultHandler(registerBackendPluginIpcHandler, 'slides:export', async (payload) => {
    return readCoordinator().exportPresentation(parsePresentationExportRequest(payload));
  });
}

export { SLIDES_IPC_CHANNELS };
