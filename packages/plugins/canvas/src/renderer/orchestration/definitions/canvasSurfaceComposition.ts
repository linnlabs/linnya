import type { CanvasSurfaceOptions, CanvasSurfacePorts } from '../../definitions/canvasSurface';
import type { createCanvasConnectionEditing } from '../../features/connections';
import type { CanvasKernelIntent } from '../../kernel';
import type { CanvasKernel } from '../../kernel';
import type { createCanvasCardOpening } from '../createCanvasCardOpening';
import type { createCanvasEditorNavigation } from '../createCanvasEditorNavigation';
import type { createCanvasRasterPresentation } from '../createCanvasRasterPresentation';
import type { createCanvasSurfaceCommands } from '../createCanvasSurfaceCommands';
import type { createCanvasSurfaceDraftEditing } from '../createCanvasSurfaceDraftEditing';
import type { createCanvasSurfaceOperations } from '../createCanvasSurfaceOperations';
import type { createCanvasSurfacePresentation } from '../createCanvasSurfacePresentation';
import type { createCanvasSurfaceSelection } from '../createCanvasSurfaceSelection';
import type { createCanvasSurfaceSession } from '../createCanvasSurfaceSession';
import type { createCanvasViewportCommands } from '../createCanvasViewportCommands';
import type { installCanvasSurfaceBindings } from '../installCanvasSurfaceBindings';

type SurfaceSession = ReturnType<typeof createCanvasSurfaceSession>;
type SurfaceDrafts = ReturnType<typeof createCanvasSurfaceDraftEditing>;
type SurfaceSelection = ReturnType<typeof createCanvasSurfaceSelection>;
type SurfaceBindings = ReturnType<typeof installCanvasSurfaceBindings>;
type SurfacePresentation = ReturnType<typeof createCanvasSurfacePresentation>;
type SurfaceViewport = ReturnType<typeof createCanvasViewportCommands>;

export interface CanvasSurfaceRendering {
  readonly kernel: CanvasKernel;
  readonly raster: ReturnType<typeof createCanvasRasterPresentation>;
  readonly refreshView: () => void;
  readonly navigate: ReturnType<typeof createCanvasEditorNavigation>;
  readonly readAppearance: SurfaceSession['readAppearance'];
}
interface CanvasSurfaceComposition {
  readonly base: SurfaceSession;
  readonly rendering: CanvasSurfaceRendering;
}
interface CanvasSurfaceHosts {
  readonly options: CanvasSurfaceOptions;
  readonly ports: CanvasSurfacePorts;
}
export interface CanvasSurfaceDraftEditingOptions
  extends CanvasSurfaceComposition,
    CanvasSurfaceHosts {
  readonly readViewport: () => SurfaceViewport;
}
export interface CanvasSurfaceSelectionOptions extends CanvasSurfaceDraftEditingOptions {
  readonly drafts: SurfaceDrafts;
}
export interface CanvasSurfaceCreationOptions extends CanvasSurfaceComposition {
  readonly options: CanvasSurfaceOptions;
  readonly drafts: SurfaceDrafts;
  readonly opening: ReturnType<typeof createCanvasCardOpening>;
  readonly connections: ReturnType<typeof createCanvasConnectionEditing>;
  readonly readViewport: () => SurfaceViewport;
}
export interface CanvasSurfaceBindingsOptions extends CanvasSurfaceComposition, CanvasSurfaceHosts {
  readonly drafts: SurfaceDrafts;
  readonly selection: SurfaceSelection;
}
export interface CanvasSurfaceIntentOptions extends CanvasSurfaceComposition {
  readonly drafts: SurfaceDrafts;
  readonly selection: SurfaceSelection;
  readonly viewport: SurfaceViewport;
}
export interface CanvasSurfacePresentationOptions extends CanvasSurfaceBindingsOptions {
  readonly bindings: SurfaceBindings;
}
export interface CanvasSurfaceCommandsOptions extends CanvasSurfaceIntentOptions {
  readonly bindings: SurfaceBindings;
}
export interface CanvasSurfaceOperationsOptions extends CanvasSurfaceBindingsOptions {
  readonly presentation: SurfacePresentation;
  readonly viewport: SurfaceViewport;
}
export interface CanvasSurfaceViewMemoryOptions extends CanvasSurfaceComposition {
  readonly options: CanvasSurfaceOptions;
}
export interface CanvasSurfaceDisposalOptions extends CanvasSurfaceComposition {
  readonly drafts: SurfaceDrafts;
  readonly selection: SurfaceSelection;
  readonly bindings: SurfaceBindings;
}
export interface CanvasSurfaceFacadeOptions extends CanvasSurfaceOperationsOptions {
  readonly bindings: SurfaceBindings;
  readonly userCommands: ReturnType<typeof createCanvasSurfaceCommands>;
  readonly operations: ReturnType<typeof createCanvasSurfaceOperations>;
  readonly destroy: () => void;
}

export interface CanvasSurfaceRenderingOptions extends CanvasSurfaceHosts {
  readonly base: SurfaceSession;
  readonly kernel: CanvasKernel;
  readonly handleIntent: (intent: CanvasKernelIntent) => Promise<void>;
}
