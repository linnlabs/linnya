export interface BrushArtworkWorkerPaths {
  readonly workerHtmlPath: string;
  readonly preloadPath: string;
}

export interface BrushArtworkWorkerRuntimeLocation {
  readonly mode: 'source-development' | 'artifact-runtime';
  readonly packageRoot: string;
  readonly rootSource: 'workspace' | 'backend-bundle' | 'explicit';
}
