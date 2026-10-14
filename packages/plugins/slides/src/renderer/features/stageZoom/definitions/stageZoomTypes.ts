export type StageZoomMode = 'fit' | 'manual';

/** 菜单选择的结果；具体缩放写入由调用方的 UI store 负责。 */
export type StageZoomMenuAction =
  | { readonly kind: 'fit' }
  | { readonly kind: 'percent'; readonly percent: number };
