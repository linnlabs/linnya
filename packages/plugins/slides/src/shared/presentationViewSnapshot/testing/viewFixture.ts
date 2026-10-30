import type { DeckPreview } from '../../deckPreview';
import type { PresentationRenderModel, SlideRenderModel } from '../../renderModel';
import type { InstalledPresentationView } from '../definitions/viewSnapshot';

export function makePresentationView(nodeId = 'deck', revision = 1, count = 3): InstalledPresentationView {
  const slides: SlideRenderModel[] = Array.from({ length: count }, (_, index) => ({
    slideId: `s${index + 1}`, index, layoutKey: 'freeform',
    background: { paint: { type: 'solid', color: '#FFFFFF' } },
    elements: [{ id: `s${index + 1}-text`, kind: 'text', box: { x: 1, y: 1, w: 4, h: 1, unit: 'in' },
      zIndex: 0, sourceSpan: { startLine: 2 + index * 5, endLine: 3 + index * 5 },
      paragraphs: [{ runs: [{ text: `Page ${index + 1}`, fontFamily: 'Arial' }] }] }],
  }));
  const renderModel: PresentationRenderModel = { presentationId: nodeId, version: revision, title: 'Fixture',
    sourceKind: 'generated', slideSize: { width: 10, height: 5.625, unit: 'in' }, slides,
    capabilities: { hasSemanticRender: true, hasReferencePreview: false, hasHitTest: true, hasSelection: true } };
  const preview: DeckPreview = { nodeId, versionNumber: revision, title: 'Fixture',
    slideSize: { width: 10, height: 5.625 }, slides: slides.map((slide, index) => ({
      slideId: slide.slideId, number: index + 1, elements: [{ elementId: slide.elements[0].id, type: 'text', text: `Page ${index + 1}` }],
    })), theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } }, warnings: [] };
  return { snapshotId: revision.toString(16).padStart(64, '0'), preview, renderModel,
    buildState: { state: 'ready', presentationId: nodeId, versionId: `v${revision}`, versionNumber: revision, sourceHash: 'a'.repeat(64) } };
}
