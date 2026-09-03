import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  DeckPreview,
  PresentationInfo,
  PresentationRenderModel,
  SlidesSourceSlicesOutput,
  TemplateSpec,
  TemplateSummary,
} from '@plugin/slides/shared';
import {
  registerSlidesIpcHandlersForCoordinator,
  registerSlidesIpcHandlersForCoordinatorProvider,
  SLIDES_IPC_CHANNELS,
  SLIDES_PLUGIN_ID,
  type SlidesBackendIpcRegistrar,
  type SlidesIpcCoordinatorPort,
} from './index';

type CapturedIpcHandler = (event: unknown, payload: unknown) => Promise<unknown> | unknown;

interface CapturedIpcRegistration {
  readonly pluginId: string;
  readonly channel: string;
  readonly handler: CapturedIpcHandler;
}

const registrations: CapturedIpcRegistration[] = [];
const registerBackendPluginIpcHandler: Mock<SlidesBackendIpcRegistrar> = vi.fn(
  (pluginId, channel, handler) => {
    registrations.push({ pluginId, channel, handler });
  },
);

const preview: DeckPreview = {
  nodeId: 'presentation-1',
  versionNumber: 1,
  title: 'Deck',
  slideSize: { width: 10, height: 5.625 },
  slides: [],
  theme: {
    colors: {},
    fonts: { major: 'Arial', minor: 'Arial' },
  },
  warnings: [],
};

const presentationInfo: PresentationInfo = {
  slideCount: 0,
  slideSize: { width: 10, height: 5.625 },
  slides: [],
  theme: {
    colors: {},
    fonts: { major: 'Arial', minor: 'Arial' },
  },
  masters: [],
};

const renderModel: PresentationRenderModel = {
  presentationId: 'presentation-1',
  title: 'Deck',
  version: 1,
  sourceKind: 'generated',
  slideSize: { width: 10, height: 5.625, unit: 'in' },
  slides: [],
  capabilities: {
    hasSemanticRender: true,
    hasReferencePreview: false,
    hasHitTest: true,
    hasSelection: true,
  },
};

const sourceSlices: SlidesSourceSlicesOutput = {
  presentationId: 'presentation-1',
  title: 'Deck',
  versionId: 'version-1',
  sourceOrigin: 'compiled',
  sourceKey: 'deck.js',
  totalLines: 10,
  slices: [],
};

const template: TemplateSpec = {
  id: 'template-1',
  name: 'Template',
  theme: {},
  layouts: [],
  masters: [],
};

const templateSummary: TemplateSummary = {
  id: 'template-1',
  name: 'Template',
  usageCount: 0,
  createdAt: 1,
};

function makeCoordinator(): SlidesIpcCoordinatorPort {
  return {
    readSourceSlicesForAiEdit: vi.fn(async () => sourceSlices),
    inspect: vi.fn(async () => presentationInfo),
    getPreview: vi.fn(async () => preview),
    getDocumentBuildState: vi.fn(async () => ({
      state: 'ready',
      presentationId: 'presentation-1',
      versionId: 'version-1',
      versionNumber: 1,
    })),
    getRenderModel: vi.fn(async () => renderModel),
    listTemplates: vi.fn(async () => [templateSummary]),
    importTemplate: vi.fn(async () => template),
    exportPresentation: vi.fn(async request => ({
      format: request.format,
      fileName: 'deck.pptx',
      byteLength: 3,
    })),
  };
}

function readHandler(channel: string): CapturedIpcHandler {
  const registration = registrations.find((item) => item.channel === channel);
  if (!registration) {
    throw new Error(`Missing test registration for ${channel}`);
  }
  return registration.handler;
}

async function invokeRegisteredHandler(channel: string, payload: unknown): Promise<unknown> {
  return await readHandler(channel)(undefined, payload);
}

describe('slides IPC handlers', () => {
  beforeEach(() => {
    registrations.length = 0;
    registerBackendPluginIpcHandler.mockClear();
  });

  it('registers all declared Slides IPC channels under the Slides plugin id', () => {
    const coordinator = makeCoordinator();

    registerSlidesIpcHandlersForCoordinator(coordinator, registerBackendPluginIpcHandler);

    expect(registrations.map((item) => item.pluginId))
      .toEqual(SLIDES_IPC_CHANNELS.map(() => SLIDES_PLUGIN_ID));
    expect(registrations.map((item) => item.channel)).toEqual([...SLIDES_IPC_CHANNELS]);
  });

  it('does not register a direct PPTX document import handler', () => {
    const coordinator = makeCoordinator();

    registerSlidesIpcHandlersForCoordinator(coordinator, registerBackendPluginIpcHandler);

    const channels = registrations.map((item) => item.channel);
    expect(channels).toContain('slides:template-import');
    expect(channels).not.toContain('slides:import');
    expect(channels).not.toContain('slides:pptx-import');
    expect(channels).not.toContain('slides:generate');
    expect(channels).not.toContain('slides:patch');
  });

  it('returns OperationResult failures for invalid payloads without calling coordinator logic', async () => {
    const coordinator = makeCoordinator();
    registerSlidesIpcHandlersForCoordinator(coordinator, registerBackendPluginIpcHandler);

    await expect(invokeRegisteredHandler('slides:source-slices', {
      nodeId: 'presentation-1',
      conversationId: 'conversation-1',
      targets: [],
    })).resolves.toEqual({
      success: false,
      error: 'targets must contain valid source slice targets.',
    });
    expect(coordinator.readSourceSlicesForAiEdit).not.toHaveBeenCalled();
  });

  it('returns unresolved draft as build-state data instead of an IPC failure', async () => {
    const coordinator = makeCoordinator();
    vi.mocked(coordinator.getDocumentBuildState).mockResolvedValueOnce({
      state: 'draft',
      presentationId: 'presentation-1',
      versionId: 'version-1',
      versionNumber: 1,
      draftStatus: {
        baseVersionId: 'version-1',
        baseVersionNumber: 1,
        errorKind: 'slides.codegen.typecheck',
        errorSummary: 'TS8006 at line 1',
        updatedAt: 100,
      },
    });
    registerSlidesIpcHandlersForCoordinator(coordinator, registerBackendPluginIpcHandler);

    await expect(invokeRegisteredHandler('slides:build-state', {
      nodeId: 'presentation-1',
    })).resolves.toMatchObject({
      success: true,
      data: {
        state: 'draft',
        draftStatus: { errorKind: 'slides.codegen.typecheck' },
      },
    });
  });

  it('transfers template buffers and strict export requests through OperationResult data', async () => {
    const coordinator = makeCoordinator();
    registerSlidesIpcHandlersForCoordinator(coordinator, registerBackendPluginIpcHandler);

    await expect(invokeRegisteredHandler('slides:template-import', {
      fileName: 'template.pptx',
      name: 'Template',
      description: 'demo',
      buffer: Uint8Array.from([1, 2, 3]),
    })).resolves.toEqual({
      success: true,
      data: template,
    });
    expect(coordinator.importTemplate).toHaveBeenCalledWith(Buffer.from([1, 2, 3]), 'Template', 'demo');

    await expect(invokeRegisteredHandler('slides:export', {
      nodeId: 'presentation-1',
      targetToken: 'target-1',
      format: 'pptx',
      chartMode: 'native',
    })).resolves.toEqual({
      success: true,
      data: {
        format: 'pptx',
        fileName: 'deck.pptx',
        byteLength: 3,
      },
    });
    expect(coordinator.exportPresentation).toHaveBeenCalledWith({
      nodeId: 'presentation-1',
      targetToken: 'target-1',
      format: 'pptx',
      chartMode: 'native',
    });
  });

  it('reads coordinator lazily when a registered handler is invoked', async () => {
    const coordinator = makeCoordinator();
    const readCoordinator = vi.fn(() => coordinator);

    registerSlidesIpcHandlersForCoordinatorProvider(readCoordinator, registerBackendPluginIpcHandler);

    expect(readCoordinator).not.toHaveBeenCalled();

    await expect(invokeRegisteredHandler('slides:templates-list', undefined)).resolves.toEqual({
      success: true,
      data: [templateSummary],
    });
    expect(readCoordinator).toHaveBeenCalledTimes(1);
    expect(coordinator.listTemplates).toHaveBeenCalledTimes(1);
  });
});
