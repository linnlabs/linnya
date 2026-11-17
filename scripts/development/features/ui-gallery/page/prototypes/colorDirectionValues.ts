/* 状态色“协调”候选：四色放到同一组 OKLCH 明度与彩度上，成功色 H153 与品牌绿分开。计划阶段，不是产品 token。 */
export const TUNED_STATUS_TOKENS = {
  "light": {
    "success": "#368e57",
    "success-text": "#016a36",
    "success-bg": "#ecf8ef",
    "error": "#ca453d",
    "error-text": "#972f29",
    "error-bg": "#fef1ef",
    "warning": "#e3a42e",
    "warning-text": "#755000",
    "warning-bg": "#fbf3e7",
    "info": "#357fc5",
    "info-text": "#005a9d",
    "info-bg": "#eef5fe"
  },
  "dark": {
    "success": "#57ae74",
    "success-text": "#9dd8ad",
    "success-bg": "#1d3725",
    "error": "#df695e",
    "error-text": "#fab3aa",
    "error-bg": "#442724",
    "warning": "#e5ac4c",
    "warning-text": "#e6c188",
    "warning-bg": "#3d2d14",
    "info": "#5b9ddf",
    "info-text": "#9dccfd",
    "info-bg": "#1e3246"
  }
} as const;
