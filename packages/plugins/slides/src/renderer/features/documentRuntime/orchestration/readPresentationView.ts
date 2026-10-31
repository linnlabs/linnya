import type { SlideRenderModel } from '@plugin/slides/shared/renderModel';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { SLIDES_IPC, SLIDES_PLUGIN_ID } from '@plugin/slides/shared/ipc';
import { restoreSlideContent, type InstalledPresentationView,
  type ViewJsonRecord, type ViewReadResponse, type ViewHeader, type ViewManifest } from '@plugin/slides/shared/presentationViewSnapshot';
import { logSlidesVerbose } from '../../../shared/diagnosticLogging';
import { readViewSnapshotResponse } from '../functions/readViewSnapshotResponse';

/** 块在完整候选拼装前由本次读取持有；不会因缓存驱逐缺失后续批次的基线。 */
export async function readPresentationView(nodeId: string, cached: ReadonlyMap<string, ViewJsonRecord>, cachedPages: ReadonlyMap<string, SlideRenderModel>): Promise<{
  installed: InstalledPresentationView; blocks: Map<string, ViewJsonRecord>; pages: Map<string, SlideRenderModel>;
}> {
  const knownHashes = [...cached.keys()];
  const blocks = new Map(cached);
  let receivedBlocks = 0;
  let batches = 0;
  let response: ViewReadResponse;
  let header: ViewHeader | null = null;
  let manifest: ViewManifest = [];
  let snapshotId: string | undefined;
  let offset: number | undefined;
  const begin = performance.now();
  do {
    const result = await invokeRendererPluginIpc<unknown>(SLIDES_PLUGIN_ID, SLIDES_IPC.viewSnapshot,
      { nodeId, knownHashes, ...(snapshotId !== undefined ? { snapshotId, offset } : {}) });
    if (!result.success) throw new Error(result.error);
    response = readViewSnapshotResponse(result.data);
    batches++; receivedBlocks += response.blocks.length;
    if (response.nodeId !== nodeId || (snapshotId !== undefined && snapshotId !== response.snapshotId)) {
      throw new Error('Slides view response identity mismatch');
    }
    if (snapshotId === undefined) {
      header = response.header;
      manifest = response.manifest;
    } else if (response.header !== null || response.manifest.length) throw new Error('Slides view continuation contains a new header');
    snapshotId = response.snapshotId;
    if (response.nextOffset !== null && response.nextOffset <= (offset ?? -1)) throw new Error('Slides view cursor did not advance');
    offset = response.nextOffset ?? undefined;
    for (const block of response.blocks) blocks.set(block.hash, block.value);
  } while (response.nextOffset !== null);
  if (!header) throw new Error('Slides view header is missing');
  const pages = new Map<string, SlideRenderModel>();
  if (header.buildState.presentationId !== nodeId) throw new Error('Slides view build identity mismatch');
  const retained = new Map<string, ViewJsonRecord>();
  const slides = manifest.map((entry, index) => {
    const content = blocks.get(entry.contentHash);
    const binding = blocks.get(entry.bindingHash);
    if (!content || !binding || entry.index !== index || binding.contentHash !== entry.contentHash) {
      throw new Error('Slides view page content/binding mismatch');
    }
    retained.set(entry.contentHash, content);
    retained.set(entry.bindingHash, binding);
    const key = `${entry.contentHash}:${entry.bindingHash}:${entry.slideId}:${index}`;
    const slide = cachedPages.get(key) ?? restoreSlideContent(content, binding, entry.slideId, index);
    pages.set(key, slide);
    return slide;
  });
  if (header.buildState.state === 'ready') {
    if (!header.render || !header.preview || header.render.presentationId !== nodeId
      || header.preview.nodeId !== nodeId || header.render.version !== header.buildState.versionNumber
      || header.preview.versionNumber !== header.buildState.versionNumber || header.preview.slides.length !== slides.length) {
      throw new Error('Slides view revision mismatch');
    }
  } else if (header.render || header.preview || slides.length) throw new Error('Slides draft contains a ready view');
  logSlidesVerbose('Ipc', 'snapshot completed', { nodeId, elapsedMs: performance.now() - begin,
    revision: header.buildState.versionNumber, pages: slides.length, retainedBlocks: retained.size, receivedBlocks, batches });
  return { installed: { snapshotId, buildState: header.buildState, preview: header.preview,
    renderModel: header.render ? { ...header.render, slides } : null }, blocks: retained, pages };
}
