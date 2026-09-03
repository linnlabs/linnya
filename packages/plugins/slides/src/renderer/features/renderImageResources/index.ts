export {
  RenderImageResourceError,
  type ImageResourceFailureMode,
  type LoadedRenderImage,
  type SlideImageResourceMap,
  type SlideImageResourceTarget,
} from './definitions/renderImageResource';
export {
  collectSlideImageResourceTargets,
  SLIDE_BACKGROUND_IMAGE_RESOURCE_KEY,
} from './functions/collectSlideImageResourceTargets';
export {
  loadImageResourceTargets,
  loadSlideImageResources,
  type LoadSlideImageResourcesOptions,
} from './orchestration/loadSlideImageResources';
export {
  clearSharedRenderImageResourceRegistry,
  createRenderImageResourceRegistry,
  sharedRenderImageResourceRegistry,
  type RenderImageResourceRegistry,
  type RenderImageResourceRegistryOptions,
} from './orchestration/renderImageResourceRegistry';
