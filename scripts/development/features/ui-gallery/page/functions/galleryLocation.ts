import {
  BUILT_IN_RENDERER_UI_THEMES,
  DEFAULT_RENDERER_UI_THEME,
  isRendererUiTheme,
  type RendererUiTheme,
} from '@linnya/renderer-ui/theme';
import { CURRENT_GALLERY_SCHEME_ID } from '../../definitions/galleryScheme.ts';
import {
  DEFAULT_GALLERY_SECTION_ID,
  GALLERY_OVERLAYS,
  GALLERY_SECTIONS,
  type GalleryOverlayId,
  type GallerySectionId,
} from '../definitions/gallerySections.ts';

/**
 * 画廊的全部可见状态都在 URL 里：同一个地址总能复现同一画面，便于截图、对比和分享。
 */
export interface GalleryLocation {
  readonly section: GallerySectionId;
  readonly theme: RendererUiTheme;
  readonly scheme: string;
  /** 被对比视图嵌入时只渲染分区本身。 */
  readonly embed: boolean;
  readonly compare: boolean;
  readonly compareSchemes: readonly string[];
  readonly compareThemes: readonly RendererUiTheme[];
  readonly open: GalleryOverlayId | null;
}

function isGallerySectionId(value: string): value is GallerySectionId {
  return GALLERY_SECTIONS.some(section => section.id === value);
}

function isGalleryOverlayId(value: string): value is GalleryOverlayId {
  return GALLERY_OVERLAYS.some(overlay => overlay === value);
}

function readList(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

/** URL 来自地址栏，认不出的值按默认画面处理。 */
export function parseGalleryLocation(
  search: string,
  schemeIds: readonly string[]
): GalleryLocation {
  const params = new URLSearchParams(search);
  const knownSchemes = [CURRENT_GALLERY_SCHEME_ID, ...schemeIds];
  const section = params.get('section') ?? '';
  const theme = params.get('theme') ?? '';
  const scheme = params.get('scheme') ?? '';
  const open = params.get('open') ?? '';
  const compareSchemes = readList(params, 'schemes').filter(id => knownSchemes.includes(id));
  const compareThemes = readList(params, 'themes').filter(isRendererUiTheme);
  return {
    section: isGallerySectionId(section) ? section : DEFAULT_GALLERY_SECTION_ID,
    theme: isRendererUiTheme(theme) ? theme : DEFAULT_RENDERER_UI_THEME,
    scheme: knownSchemes.includes(scheme) ? scheme : CURRENT_GALLERY_SCHEME_ID,
    embed: params.get('embed') === '1',
    compare: params.get('view') === 'compare',
    compareSchemes: compareSchemes.length > 0 ? compareSchemes : knownSchemes,
    compareThemes: compareThemes.length > 0 ? compareThemes : [...BUILT_IN_RENDERER_UI_THEMES],
    open: isGalleryOverlayId(open) ? open : null,
  };
}

/** 只写出与默认值不同的参数，地址保持短。 */
export function serializeGalleryLocation(location: GalleryLocation): string {
  const params = new URLSearchParams();
  if (location.section !== DEFAULT_GALLERY_SECTION_ID) params.set('section', location.section);
  if (location.theme !== DEFAULT_RENDERER_UI_THEME) params.set('theme', location.theme);
  if (location.scheme !== CURRENT_GALLERY_SCHEME_ID) params.set('scheme', location.scheme);
  if (location.embed) params.set('embed', '1');
  if (location.compare) {
    params.set('view', 'compare');
    params.set('schemes', location.compareSchemes.join(','));
    params.set('themes', location.compareThemes.join(','));
  }
  if (location.open) params.set('open', location.open);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

/** 对比网格里一格的地址：固定主题与方案、只渲染分区。 */
export function createEmbeddedGallerySearch(
  section: GallerySectionId,
  theme: RendererUiTheme,
  scheme: string
): string {
  return serializeGalleryLocation({
    section,
    theme,
    scheme,
    embed: true,
    compare: false,
    compareSchemes: [],
    compareThemes: [],
    open: null,
  });
}
