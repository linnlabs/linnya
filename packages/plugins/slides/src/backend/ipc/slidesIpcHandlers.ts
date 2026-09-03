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
} from '@plugin/slides/shared';
import {
  parseSlidesNodePayload,
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
  readSourceSlicesForAiEdit(input: SlidesSourceSlicesForAiEditInput): Promise<SlidesSourceSlicesOutput>;
  inspect(nodeId: string): Promise<PresentationInfo>;
  getPreview(nodeId: string): Promise<DeckPreview>;
  getDocumentBuildState(nodeId: string): Promise<SlidesDocumentBuildState>;
  getRenderModel(nodeId: string): Promise<PresentationRenderModel>;
  listTemplates(): Promise<TemplateSummary[]>;
  importTemplate(buffer: Buffer, name: string, description?: string): Promise<TemplateSpec>;
  exportPresentation(request: PresentationExportRequest): Promise<PresentationExportResult>;
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
