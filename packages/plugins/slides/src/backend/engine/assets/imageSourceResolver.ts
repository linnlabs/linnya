/**
 * imageSourceResolver — 异步图片来源归一化
 *
 * 在编译 (`DeckAssembler.assemble`) 和渲染模型 (`PptPresentationQueryService.getRenderModel`)
 * 两个入口前调用，把 authoring 图片来源交给注入 resolver 解析为已授权内容。
 *
 * 解析失败时抛错终止当前操作；不能在 engine 内静默保留路径或远程 URL。
 */

import type {
  DeckSpec,
  FreeformElement,
  ImageSourceInput,
  StructuredElement,
} from '@plugin/slides/shared';
import { resolveSlideSizeInches } from '@plugin/slides/shared/deckSpec';
import type { ImageSourceResolveContext, ImageSourceResolverPort } from '../types.js';
import { resolveImageSourceRef } from './imageAssetResolver';

/**
 * 遍历 DeckSpec 所有图片来源并原地替换为 resolver 返回的已授权内容。
 */
export async function resolveImageSources(
  deckSpec: DeckSpec,
  resolver: ImageSourceResolverPort,
  context?: ImageSourceResolveContext
): Promise<void> {
  const slideSize = resolveSlideSizeInches(deckSpec.layout);
  for (const entry of deckSpec.slides) {
    const bg = entry.spec.background;
    if (bg?.image) {
      bg.image = await resolveIfNeeded(
        bg.image,
        resolver,
        withTargetSize(context, slideSize.width, slideSize.height),
      );
    }
    for (const el of entry.spec.elements) {
      await resolveElement(el, resolver, context);
    }
  }
}

// ─── 内部辅助 ──────────────────────────────────────────────────────────

async function resolveElement(
  el: StructuredElement | FreeformElement,
  resolver: ImageSourceResolverPort,
  context?: ImageSourceResolveContext
): Promise<void> {
  if (el.type === 'image' && el.src) {
    el.src = await resolveIfNeeded(
      el.src,
      resolver,
      withTargetSize(context, el.position.w, el.position.h),
    );
    return;
  }
  if (el.type === 'group' && el.children) {
    for (const child of el.children) {
      await resolveElement(child, resolver, context);
    }
  }
}

function withTargetSize(
  context: ImageSourceResolveContext | undefined,
  width: number,
  height: number,
): ImageSourceResolveContext {
  return {
    ...(context ?? {}),
    targetSizeInches: { width, height },
  };
}

async function resolveIfNeeded(
  source: ImageSourceInput,
  resolver: ImageSourceResolverPort,
  context?: ImageSourceResolveContext
): Promise<ImageSourceInput> {
  return resolver.resolveImageSource(resolveImageSourceRef(source), context);
}
