import type {
  DeckSpec,
  FreeformElement,
  SvgGraphicOwnedAssetRef,
  SvgGraphicResolvedAsset,
} from '@plugin/slides/shared';
import type {
  SlidesAssetResolveContext,
  SvgGraphicAssetResolverPort,
} from '../types';

/**
 * 单次 engine 执行内读取 DeckSpec 引用的授权 SVG 内容。
 * canonical XML 只存在于返回 map，不会被写回长期保存的 DeckSpec。
 */
export async function resolveSvgGraphicAssets(
  deckSpec: DeckSpec,
  resolver: SvgGraphicAssetResolverPort,
  context?: SlidesAssetResolveContext,
): Promise<ReadonlyMap<string, SvgGraphicResolvedAsset>> {
  const refs = collectSvgGraphicRefs(deckSpec);
  const resolvedEntries = await Promise.all(
    Array.from(refs.values()).map(async (ref) => {
      const resolved = await resolver.resolveSvgGraphicAsset(ref, context);
      assertResolvedAssetMatchesRef(resolved, ref);
      return [ref.assetId, resolved] as const;
    }),
  );
  return new Map(resolvedEntries);
}

function collectSvgGraphicRefs(
  deckSpec: DeckSpec,
): ReadonlyMap<string, SvgGraphicOwnedAssetRef> {
  const refs = new Map<string, SvgGraphicOwnedAssetRef>();
  for (const slide of deckSpec.slides) {
    if (slide.spec.type === 'structured') {
      for (const element of slide.spec.elements) {
        if (element.type === 'svgGraphic') addUniqueRef(refs, element.asset);
      }
      continue;
    }
    collectFreeformRefs(slide.spec.elements, refs);
  }
  return refs;
}

function collectFreeformRefs(
  elements: readonly FreeformElement[],
  refs: Map<string, SvgGraphicOwnedAssetRef>,
): void {
  for (const element of elements) {
    if (element.type === 'svgGraphic') {
      addUniqueRef(refs, element.asset);
    } else if (element.type === 'group' && element.children) {
      collectFreeformRefs(element.children, refs);
    }
  }
}

function addUniqueRef(
  refs: Map<string, SvgGraphicOwnedAssetRef>,
  ref: SvgGraphicOwnedAssetRef,
): void {
  const current = refs.get(ref.assetId);
  if (current && !sameOwnedAssetRef(current, ref)) {
    throw new Error('DeckSpec contains conflicting SVG Graphic asset references.');
  }
  refs.set(ref.assetId, ref);
}

function assertResolvedAssetMatchesRef(
  resolved: SvgGraphicResolvedAsset,
  ref: SvgGraphicOwnedAssetRef,
): void {
  if (!sameOwnedAssetRef(resolved, ref) || !resolved.canonicalSvg) {
    throw new Error('Resolved SVG Graphic content conflicts with its DeckSpec reference.');
  }
}

function sameOwnedAssetRef(
  left: SvgGraphicOwnedAssetRef,
  right: SvgGraphicOwnedAssetRef,
): boolean {
  return left.kind === right.kind
    && left.assetId === right.assetId
    && left.contentHash === right.contentHash
    && left.byteLength === right.byteLength
    && left.viewBox.width === right.viewBox.width
    && left.viewBox.height === right.viewBox.height;
}
