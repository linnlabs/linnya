/** 0–255 的 sRGB 三通道。 */
export type RgbColor = readonly [number, number, number];

/** 图片上的点，按宽高的比例（0–1，左上为 0,0），与 Slides `crop` / `focus` 同一种量法。 */
export type ImagePoint = readonly [x: number, y: number];

/** 图片上的矩形区域，按宽高的比例。 */
export interface ImageRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** 图上的像素矩形，只在本 domain 内部用。 */
export interface PixelBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** 从原图各边裁掉的比例，字段与 Slides Image 的 `crop` 一致。 */
export interface ImageCrop {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** 左上、右上、右下、左下，顺时针。 */
export type ImageQuad = readonly [ImagePoint, ImagePoint, ImagePoint, ImagePoint];

export type TextureKind = 'paper' | 'grain';

/** 宫格的去底方式：品红、绿走色键，其余纯色底（白底、灰底）从边框泛洪。 */
export type SheetKeyMode = 'magenta' | 'green' | 'flood';

/** 去背怎么做：`auto` 在本机有系统前景遮罩（macOS 14+ 的 Vision）时用它，没有时按边缘颜色抠。 */
export type CutoutMethod = 'auto' | 'vision' | 'edge';
/** 实际用上的去背方式。 */
export type CutoutEngine = 'vision' | 'edge';

/** 标题字的排列：横排从左到右，竖排从上到下。 */
export type TitleDirection = 'horizontal' | 'vertical';

export type ImageProcessingErrorCode =
  /** 不是 JPEG、PNG、WebP，或解码失败、超过像素上限。 */
  | 'image_unreadable'
  /** 参数在几何或取值上不成立：区域越界、四边形自交、尺寸超限等。 */
  | 'invalid_options'
  /** 墨迹转透明只适用于白纸、浅底；底色偏暗时结果没有意义。 */
  | 'background_not_light'
  /** 宫格的边框颜色不一致，不是纯色底（例如生图模型画出来的假棋盘格）。 */
  | 'background_not_uniform'
  /** 宫格上没找到元素。 */
  | 'no_pieces'
  /** 连通块太多，多半是元素挨得太近或底上有杂点，应改按格子切。 */
  | 'too_many_pieces'
  /** 指定用 Vision 去背，但本机不是 macOS 14 及以上。 */
  | 'vision_unavailable'
  /** 系统前景遮罩运行失败。 */
  | 'vision_failed'
  /** 去背后没有剩下前景。 */
  | 'no_foreground'
  /** 不是 fontkit 能读的单个字体（TTF、OTF、WOFF、WOFF2），或是字体集合。 */
  | 'font_unreadable'
  /** 字体里缺标题用到的字。 */
  | 'missing_glyphs';

export interface ImageProcessingFailure {
  readonly status: 'failed';
  readonly code: ImageProcessingErrorCode;
  readonly message: string;
}

export type EncodedImageFormat = 'png' | 'jpeg';

export interface EncodedImage {
  readonly bytes: Uint8Array;
  readonly format: EncodedImageFormat;
  readonly width: number;
  readonly height: number;
}

export type ImageProcessingOutcome<T> = { readonly status: 'ok'; readonly value: T } | ImageProcessingFailure;

export interface TrimMeasurement {
  /** 裁掉的比例；四边都是 0 表示没有可裁的边。 */
  readonly crop: ImageCrop;
  /** 量裁边时用的图（已按 EXIF 摆正）的像素尺寸。 */
  readonly width: number;
  readonly height: number;
  /** `save` 时才有：裁好后另存的图。 */
  readonly image?: EncodedImage;
}

export interface SheetSlice {
  /** 实测底色。 */
  readonly background: RgbColor;
  readonly mode: SheetKeyMode;
  /** 可见像素里仍带键色的比例（0–1）；泛洪模式为 0。 */
  readonly residual: number;
  /** 按阅读顺序（从上到下、从左到右）排列，空格子不出。 */
  readonly pieces: readonly EncodedImage[];
  /** 所有元素排在灰色棋盘格上、带序号的检查图，一次看完有没有残边。 */
  readonly check: EncodedImage;
}

export interface ForegroundCutout {
  readonly engine: CutoutEngine;
  /** `auto` 时 Vision 没找到前景，改用了边缘抠图。 */
  readonly visionFoundNothing: boolean;
  /** 前景（透明度过半）占整张图的比例，0–1。 */
  readonly foregroundRatio: number;
  /** 图片最外一圈里前景的比例，0–1。偏高说明背景没去干净，或主体本来就被画面切到。 */
  readonly borderForeground: number;
  /** 前景占比或贴边比例超出常见范围，结果多半要换方法或换图。只拦得住一部分失败，检查图仍要看。 */
  readonly suspicious: boolean;
  /** 裁到主体范围的透明 PNG。 */
  readonly image: EncodedImage;
  /** 左边原图、右边去背结果叠在品红底上，残留的背景和被误抠的主体都看得出。 */
  readonly check: EncodedImage;
}

export interface TitleRendering {
  /** 字体全名，例如 “Ma Shan Zheng Regular”。 */
  readonly fontName: string;
  /** 字体 name 表里写的许可与链接；没写时为 null，要按来源仓库的声明确认。 */
  readonly license: string | null;
  readonly licenseUrl: string | null;
  /** 只含 path 的 SVG，根节点只有 viewBox，可直接交给文档的矢量图形。 */
  readonly svg: { readonly text: string; readonly width: number; readonly height: number; readonly pathCommands: number };
  /** 同一轮廓栅格化的透明 PNG，一个 em 等于 `size` 像素。 */
  readonly image: EncodedImage;
}

/** 标题最多的字数：标题字是一两行的大字，再长就该用正文字体。 */
export const TITLE_MAX_CHARACTERS = 40;
/** 标题 PNG 的最大边长；16:9 页面铺满宽度 1920px 就清晰，8192 是给竖排长句留的余量。 */
export const TITLE_MAX_EDGE = 8192;

/** 一张宫格最多切出的块数；超过时多半是元素粘连或底上有杂点。 */
export const MAX_SHEET_PIECES = 64;

/**
 * 处理时的长边上限。铺满 16:9 页面的背景图 1920px 宽就清晰，2400px 留了余量；
 * 实测 5800 万像素的原图不缩时一次处理到 865MB，先缩到 2400 后约 100MB。
 */
export const PROCESSING_MAX_EDGE = 2400;
/** 坐标网格只给看图模型定位用，模型看图的分辨率有限，再大没有意义。 */
export const GRID_MAX_EDGE = 1600;
/** 与配色取色同一档：超过的图连解码都不做，避免解压炸弹。 */
export const MAX_INPUT_PIXELS = 100_000_000;
/** 程序纹理的最大边长。 */
export const TEXTURE_MAX_EDGE = 4096;
