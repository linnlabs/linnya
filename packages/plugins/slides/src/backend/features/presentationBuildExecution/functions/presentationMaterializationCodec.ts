import type {
  DeckSpec,
  FreeformElement,
  SvgGraphicOwnedAssetRef,
  SvgGraphicResolvedAsset,
} from '@plugin/slides/shared';
import { isMathFormulaSource, isSlideLayout } from '@plugin/slides/shared';
import { parseShapeGeometrySpec } from '@plugin/slides/shared';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';

import type {
  PresentationMaterializationInput,
  PresentationMaterializedSvgFallback,
} from '../definitions/presentationBuildExecution';
import {
  PRESENTATION_BUILD_MATERIALIZATION_BINARY_MAX_BYTES,
  PRESENTATION_BUILD_MATERIALIZATION_ELEMENT_MAX_COUNT,
  PRESENTATION_BUILD_MATERIALIZATION_JSON_MAX_BYTES,
  PRESENTATION_BUILD_MATERIALIZATION_SLIDE_MAX_COUNT,
  PRESENTATION_BUILD_MATERIALIZATION_SVG_MAX_COUNT,
  type PresentationBuildWorkerMaterializedSvgFallback,
} from '../definitions/presentationBuildWorkerProtocol';
import {
  isSandboxJsonObject,
  measureJsonBytes,
  projectSandboxJsonObject,
} from '../../../sandbox/sandboxJson';

interface EncodedPresentationMaterializationInput {
  readonly deckSpec: SandboxJsonObject;
  readonly svgAssets: readonly SandboxJsonObject[];
  readonly svgFallbacks: readonly PresentationBuildWorkerMaterializedSvgFallback[];
}

interface ElementBudget {
  count: number;
}

const STRUCTURED_ELEMENT_TYPES = new Set([
  'title',
  'text',
  'bulletList',
  'numberedList',
  'chart',
  'table',
  'image',
  'shape',
  'svgGraphic',
  'formula',
]);

const FREEFORM_ELEMENT_TYPES = new Set([
  'text',
  'shape',
  'image',
  'svgGraphic',
  'formula',
  'group',
]);

export function encodePresentationMaterializationInput(
  input: PresentationMaterializationInput,
): EncodedPresentationMaterializationInput {
  const deckSpec = projectSandboxJsonObject(input.deckSpec);
  const svgAssets = input.svgAssets.map(asset => projectSandboxJsonObject(asset));
  const svgFallbacks = input.svgFallbacks.map(encodeSvgFallback);
  return readEncodedPresentationMaterializationInput({
    deckSpec,
    svgAssets,
    svgFallbacks,
  });
}

export function readPresentationMaterializationInput(input: {
  readonly deckSpec: unknown;
  readonly svgAssets: unknown;
  readonly svgFallbacks: unknown;
}): PresentationMaterializationInput {
  if (!isSandboxJsonObject(input.deckSpec) || !isMaterializableDeckSpec(input.deckSpec)) {
    throw new Error('Slides materialization deck spec is invalid.');
  }
  if (
    !Array.isArray(input.svgAssets)
    || input.svgAssets.length > PRESENTATION_BUILD_MATERIALIZATION_SVG_MAX_COUNT
    || !input.svgAssets.every(isSvgGraphicResolvedAsset)
  ) {
    throw new Error('Slides materialization SVG assets are invalid.');
  }
  if (
    measureJsonBytes(input.deckSpec) + measureJsonBytes(input.svgAssets)
    > PRESENTATION_BUILD_MATERIALIZATION_JSON_MAX_BYTES
  ) {
    throw new Error('Slides materialization JSON exceeds the build worker byte limit.');
  }
  if (
    !Array.isArray(input.svgFallbacks)
    || input.svgFallbacks.length > PRESENTATION_BUILD_MATERIALIZATION_SVG_MAX_COUNT
  ) {
    throw new Error('Slides materialization SVG fallbacks are invalid.');
  }

  const svgFallbacks = input.svgFallbacks.map(readSvgFallback);
  const totalBinaryBytes = svgFallbacks.reduce(
    (total, fallback) => total + fallback.pngBytes.byteLength,
    0,
  );
  if (totalBinaryBytes > PRESENTATION_BUILD_MATERIALIZATION_BINARY_MAX_BYTES) {
    throw new Error('Slides materialization binary input exceeds the build worker byte limit.');
  }
  assertUniqueSvgMaterializationAssets(input.svgAssets, svgFallbacks);

  return {
    deckSpec: input.deckSpec,
    svgAssets: input.svgAssets,
    svgFallbacks,
  };
}

function readEncodedPresentationMaterializationInput(
  input: EncodedPresentationMaterializationInput,
): EncodedPresentationMaterializationInput {
  readPresentationMaterializationInput(input);
  return input;
}

function encodeSvgFallback(
  fallback: PresentationMaterializedSvgFallback,
): PresentationBuildWorkerMaterializedSvgFallback {
  const pngBytes = toTransferableArrayBuffer(fallback.pngBytes);
  return {
    assetId: fallback.assetId,
    contentHash: fallback.contentHash,
    pngBytes,
    widthPx: fallback.widthPx,
    heightPx: fallback.heightPx,
  };
}

function readSvgFallback(value: unknown): PresentationMaterializedSvgFallback {
  if (
    !isRecord(value)
    || !isBoundedIdentity(value.assetId)
    || !isBoundedIdentity(value.contentHash)
    || !(value.pngBytes instanceof ArrayBuffer)
    || value.pngBytes.byteLength === 0
    || !isPositiveInteger(value.widthPx)
    || !isPositiveInteger(value.heightPx)
  ) {
    throw new Error('Slides materialization SVG fallback fields are invalid.');
  }
  return {
    assetId: value.assetId,
    contentHash: value.contentHash,
    pngBytes: new Uint8Array(value.pngBytes),
    widthPx: value.widthPx,
    heightPx: value.heightPx,
  };
}

function toTransferableArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Worker transfer 会 detach backing store；始终复制一次，不能破坏 resolver/
  // hidden renderer 可能仍持有的领域字节。跨线程传输本身仍是零拷贝。
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function assertUniqueSvgMaterializationAssets(
  assets: readonly SvgGraphicResolvedAsset[],
  fallbacks: readonly PresentationMaterializedSvgFallback[],
): void {
  const assetIds = new Set<string>();
  for (const asset of assets) {
    if (assetIds.has(asset.assetId)) {
      throw new Error('Slides materialization contains duplicate SVG assets.');
    }
    assetIds.add(asset.assetId);
  }
  const fallbackIds = new Set<string>();
  for (const fallback of fallbacks) {
    if (fallbackIds.has(fallback.assetId)) {
      throw new Error('Slides materialization contains duplicate SVG fallbacks.');
    }
    fallbackIds.add(fallback.assetId);
    const asset = assets.find(candidate => candidate.assetId === fallback.assetId);
    if (!asset || asset.contentHash !== fallback.contentHash) {
      throw new Error('Slides materialization SVG fallback does not match its asset.');
    }
  }
  if (assets.length !== fallbacks.length) {
    throw new Error('Slides materialization requires one fallback for every SVG asset.');
  }
}

function isMaterializableDeckSpec(value: unknown): value is DeckSpec {
  if (
    !isRecord(value)
    || typeof value.title !== 'string'
    || value.title.trim().length === 0
    || (value.layout !== undefined && !isSlideLayout(value.layout))
    || !Array.isArray(value.slides)
    || value.slides.length === 0
    || value.slides.length > PRESENTATION_BUILD_MATERIALIZATION_SLIDE_MAX_COUNT
  ) {
    return false;
  }
  const budget: ElementBudget = { count: 0 };
  return value.slides.every((slide, index) => (
    isRecord(slide)
    && slide.slideNumber === index + 1
    && isRecord(slide.spec)
    && Array.isArray(slide.spec.elements)
    && isSelfContainedBackground(slide.spec.background)
    && (
      slide.spec.type === 'structured'
        ? slide.spec.elements.every(element => isStructuredElement(element, budget))
        : slide.spec.type === 'freeform'
          && slide.spec.elements.every(element => isFreeformElement(element, budget))
    )
  ));
}

function isStructuredElement(value: unknown, budget: ElementBudget): boolean {
  if (!consumeElementBudget(budget) || !isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  if (!STRUCTURED_ELEMENT_TYPES.has(value.type) || !isBox(value.position)) return false;
  switch (value.type) {
    case 'title':
      return typeof value.content === 'string';
    case 'text':
      return isInlineTextContent(value.content);
    case 'bulletList':
    case 'numberedList':
      return Array.isArray(value.items) && value.items.every(item => (
        isRecord(item)
        && typeof item.text === 'string'
        && (item.level === undefined || isNonNegativeInteger(item.level))
      ));
    case 'chart':
      return isChartElement(value);
    case 'table':
      return Array.isArray(value.rows)
        && value.rows.every(row => Array.isArray(row) && row.every(isTableCell));
    case 'image':
      return isEmbeddedImageSource(value.src);
    case 'shape':
      return isShapeGeometry(value.geometry);
    case 'svgGraphic':
      return isSvgGraphicOwnedAssetRef(value.asset);
    case 'formula':
      return isMathFormulaSource(value.source);
    default:
      return false;
  }
}

function isFreeformElement(value: unknown, budget: ElementBudget): value is FreeformElement {
  if (!consumeElementBudget(budget) || !isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  if (!FREEFORM_ELEMENT_TYPES.has(value.type) || !isBox(value.position)) return false;
  switch (value.type) {
    case 'text':
      return value.content === undefined || isInlineTextContent(value.content);
    case 'shape':
      return (value.geometry === undefined || isShapeGeometry(value.geometry))
        && (value.content === undefined || isPlainTextContent(value.content));
    case 'image':
      return value.src === undefined || isEmbeddedImageSource(value.src);
    case 'svgGraphic':
      return isSvgGraphicOwnedAssetRef(value.asset);
    case 'formula':
      return isMathFormulaSource(value.source);
    case 'group':
      return value.children === undefined
        || (Array.isArray(value.children)
          && value.children.every(child => isFreeformElement(child, budget)));
    default:
      return false;
  }
}

function consumeElementBudget(budget: ElementBudget): boolean {
  budget.count += 1;
  return budget.count <= PRESENTATION_BUILD_MATERIALIZATION_ELEMENT_MAX_COUNT;
}

function isInlineTextContent(value: unknown): boolean {
  return typeof value === 'string'
    || (Array.isArray(value) && value.every(run => (
      isPlainTextRun(run) || isFormulaTextRun(run)
    )));
}

function isPlainTextContent(value: unknown): boolean {
  return typeof value === 'string'
    || (Array.isArray(value) && value.every(isPlainTextRun));
}

function isPlainTextRun(value: unknown): boolean {
  return isRecord(value) && typeof value.text === 'string';
}

function isFormulaTextRun(value: unknown): boolean {
  return isRecord(value) && isMathFormulaSource(value.formula);
}

function isChartElement(value: Record<string, unknown>): boolean {
  if (
    typeof value.chartType !== 'string'
    || !isRecord(value.data)
    || !Array.isArray(value.data.categories)
    || !value.data.categories.every(category => typeof category === 'string')
    || !Array.isArray(value.data.series)
  ) {
    return false;
  }
  return value.data.series.every(series => (
    isRecord(series)
    && typeof series.name === 'string'
    && Array.isArray(series.labels)
    && series.labels.every(label => typeof label === 'string')
    && Array.isArray(series.values)
    && series.values.every(isFiniteNumber)
  ));
}

function isTableCell(value: unknown): boolean {
  return isRecord(value) && typeof value.text === 'string';
}

function isEmbeddedImageSource(value: unknown): boolean {
  return (typeof value === 'string' && value.startsWith('data:'))
    || (isRecord(value) && value.kind === 'data_uri' && typeof value.dataUri === 'string');
}

function isSelfContainedBackground(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return value.image === undefined || isEmbeddedImageSource(value.image);
}

function isShapeGeometry(value: unknown): boolean {
  try {
    return parseShapeGeometrySpec(value) !== undefined;
  } catch {
    return false;
  }
}

function isSvgGraphicResolvedAsset(value: unknown): value is SvgGraphicResolvedAsset {
  return isSvgGraphicOwnedAssetRef(value)
    && isRecord(value)
    && typeof value.canonicalSvg === 'string'
    && Buffer.byteLength(value.canonicalSvg, 'utf8') === value.byteLength;
}

function isSvgGraphicOwnedAssetRef(value: unknown): value is SvgGraphicOwnedAssetRef {
  return isRecord(value)
    && value.kind === 'owned_svg'
    && isBoundedIdentity(value.assetId)
    && isBoundedIdentity(value.contentHash)
    && isNonNegativeInteger(value.byteLength)
    && isRecord(value.viewBox)
    && isPositiveFiniteNumber(value.viewBox.width)
    && isPositiveFiniteNumber(value.viewBox.height);
}

function isBox(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isPositiveFiniteNumber(value.w)
    && isPositiveFiniteNumber(value.h);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
