/* 颜色方向原型的候选取值，由 OKLCH 计算生成（中性色保持现有灰阶的明度，只加极低彩度）。计划阶段，不是产品 token。 */
export const COLOR_DIRECTION_VALUES = {
 "neutral": {
  "sage": {
   "light": {
    "bg-sidebar": "#f7fbf9",
    "bg-subtle": "#f2f6f4",
    "bg-search": "#eef2f0",
    "text-primary": "#121916",
    "text-secondary": "#434b47",
    "text-tertiary": "#5d6561",
    "text-placeholder": "#939c97",
    "text-muted": "#6d7571",
    "border-default": "#d1d5d3",
    "border-light": "#e2e6e4",
    "border-hover": "#a0a4a2"
   },
   "dark": {
    "bg-default": "#141816",
    "bg-surface": "#232725",
    "bg-elevated": "#2a2e2c",
    "bg-sidebar": "#232725",
    "bg-subtle": "#2a2e2c",
    "bg-search": "#303432",
    "text-primary": "#eaeeec",
    "text-secondary": "#b9bdbb",
    "text-tertiary": "#a0a4a2",
    "text-placeholder": "#707472",
    "text-muted": "#707472"
   }
  },
  "warm": {
   "light": {
    "bg-sidebar": "#fcfaf6",
    "bg-subtle": "#f7f5f1",
    "bg-search": "#f3f1ed",
    "text-primary": "#1a1612",
    "text-secondary": "#4c4843",
    "text-tertiary": "#67625d",
    "text-placeholder": "#9d9893",
    "text-muted": "#77726d",
    "border-default": "#d6d4d1",
    "border-light": "#e7e5e2",
    "border-hover": "#a5a3a0"
   },
   "dark": {
    "bg-default": "#191714",
    "bg-surface": "#282622",
    "bg-elevated": "#2f2d29",
    "bg-sidebar": "#282622",
    "bg-subtle": "#2f2d29",
    "bg-search": "#35332f",
    "text-primary": "#f0ede9",
    "text-secondary": "#bebcb8",
    "text-tertiary": "#a5a39f",
    "text-placeholder": "#75736f",
    "text-muted": "#75736f"
   }
  }
 },
 "brand": {
  "forest": {
   "light": {
    "accent": "#28653c",
    "accent-solid": "#28653c",
    "accent-solid-hover": "#1b532f",
    "accent-hover": "#1b532f",
    "accent-text": "#1b532f",
    "accent-bg": "#e1f4e5",
    "accent-bg-hover": "#d5eedb",
    "accent-bg-subtle": "#f2faf3",
    "accent-light": "#468a5b",
    "border-accent-light": "#9dcba8",
    "focus-ring": "#28653c"
   },
   "dark": {
    "accent": "#56a66f",
    "accent-solid": "#28653c",
    "accent-solid-hover": "#1b532f",
    "accent-hover": "#1b532f",
    "accent-text": "#9dd4ab",
    "accent-bg": "#20432b",
    "accent-bg-hover": "#284f33",
    "accent-bg-subtle": "#1e3424",
    "accent-light": "#4d9d66",
    "border-accent-light": "#97cda4",
    "focus-ring": "#56a66f"
   }
  },
  "jade": {
   "light": {
    "accent": "#217d5f",
    "accent-solid": "#217d5f",
    "accent-solid-hover": "#156b4f",
    "accent-hover": "#156b4f",
    "accent-text": "#156b4f",
    "accent-bg": "#def5ea",
    "accent-bg-hover": "#d1eee1",
    "accent-bg-subtle": "#f0faf5",
    "accent-light": "#41a480",
    "border-accent-light": "#90cdb3",
    "focus-ring": "#217d5f"
   },
   "dark": {
    "accent": "#55b38f",
    "accent-solid": "#217d5f",
    "accent-solid-hover": "#156b4f",
    "accent-hover": "#156b4f",
    "accent-text": "#96d4b9",
    "accent-bg": "#144433",
    "accent-bg-hover": "#1b503d",
    "accent-bg-subtle": "#183429",
    "accent-light": "#4baa86",
    "border-accent-light": "#90cdb3",
    "focus-ring": "#55b38f"
   }
  },
  "ink": {
   "light": {
    "accent": "#262626",
    "accent-solid": "#2d2d2d",
    "accent-solid-hover": "#171717",
    "accent-hover": "#171717",
    "accent-text": "#262626",
    "accent-bg": "#ededed",
    "accent-bg-hover": "#e5e5e5",
    "accent-bg-subtle": "#f5f5f5",
    "accent-light": "#525252",
    "border-accent-light": "#bcbcbc",
    "focus-ring": "#737373",
    "text-on-accent": "#ffffff"
   },
   "dark": {
    "accent": "#e5e5e5",
    "accent-solid": "#e5e5e5",
    "accent-solid-hover": "#fafafa",
    "accent-hover": "#fafafa",
    "accent-text": "#ededed",
    "accent-bg": "#3a3a3a",
    "accent-bg-hover": "#404040",
    "accent-bg-subtle": "#2d2d2d",
    "accent-light": "#d4d4d4",
    "border-accent-light": "#737373",
    "focus-ring": "#a3a3a3",
    "text-on-accent": "#171717"
   }
  }
 },
 "status": {
  "tuned": {
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
  }
 }
} as const;
