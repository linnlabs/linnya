/**
 * 画廊里的一个候选视觉方案：一份覆盖 Renderer UI token 的 CSS。
 *
 * 公共仓只提供读取与切换机制，不保存候选方案本身；方案文件由使用者放在仓外目录，
 * 通过 `--schemes <目录>` 或 `LINNYA_UI_GALLERY_SCHEMES_DIR` 交给画廊。
 */
export interface GalleryScheme {
  /** 文件名去掉 `.css`，同时用作 URL 参数。 */
  readonly id: string;
  /** 文件第一段注释的第一行；没有注释时等于 id。 */
  readonly label: string;
  readonly css: string;
}

/** 不加载任何覆盖、即仓库当前 token 的方案标识。 */
export const CURRENT_GALLERY_SCHEME_ID = 'current';

export const GALLERY_SCHEMES_VIRTUAL_MODULE_ID = 'virtual:linnya-ui-gallery-schemes';
