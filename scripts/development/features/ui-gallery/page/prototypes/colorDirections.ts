import { contrast, css, fitLightness, hexToOklch, WHITE, type Oklch } from './colorMath.ts';

/**
 * 颜色方向原型（计划阶段）：从少量输入推出整套覆盖变量。
 * - 中性色：保持现有灰阶的明度，只加色偏；彩度靠近白色时收窄（impeccable colorize：近白近黑减彩度）。
 * - 强调色：输入品牌色（相当于现有 brand-500）的明度、彩度、色相，按对比度目标推出实底、文字、浅底。
 */
export type PreviewTheme = 'light' | 'dark';
export type TokenMap = Record<string, string>;

const LIGHT_NEUTRALS: Readonly<Record<string, string>> = {
  'bg-sidebar': '#fafafa',
  'bg-subtle': '#f5f5f5',
  'bg-search': '#f1f1f1',
  'text-primary': '#171717',
  'text-secondary': '#494949',
  'text-tertiary': '#636363',
  'text-placeholder': '#999999',
  'text-muted': '#737373',
  'border-default': '#d4d4d4',
  'border-light': '#e5e5e5',
  'border-hover': '#a3a3a3',
};

const DARK_NEUTRALS: Readonly<Record<string, string>> = {
  'bg-default': '#171717',
  'bg-surface': '#262626',
  'bg-elevated': '#2d2d2d',
  'bg-sidebar': '#262626',
  'bg-subtle': '#2d2d2d',
  'bg-search': '#333333',
  'text-primary': '#ededed',
  'text-secondary': '#bcbcbc',
  'text-tertiary': '#a3a3a3',
  'text-placeholder': '#737373',
  'text-muted': '#737373',
};

/** 色偏强度 1 时深色区域的最大彩度。上一版鼠尾草灰在近白底上用了 0.005，明显偏色。 */
export const NEUTRAL_MAX_CHROMA = 0.012;

function neutralTaper(lightness: number): number {
  return Math.min(1, Math.max(0, (1 - lightness) / 0.2));
}

export function neutralTokens(theme: PreviewTheme, hue: number, amount: number): TokenMap {
  if (amount <= 0) return {};
  const source = theme === 'light' ? LIGHT_NEUTRALS : DARK_NEUTRALS;
  const tokens: TokenMap = {};
  for (const [name, hex] of Object.entries(source)) {
    const { l } = hexToOklch(hex);
    tokens[name] = css({ l, c: NEUTRAL_MAX_CHROMA * amount * neutralTaper(l), h: hue });
  }
  return tokens;
}

export interface GreenCandidate {
  readonly id: string;
  readonly label: string;
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

/** 现状 brand-500：L0.648 C0.139 H148。候选整体往“更低彩度、更冷（色相加大）、更亮”走，留一个近现状色相作参照。 */
export const GREEN_CANDIDATES: readonly GreenCandidate[] = [
  { id: 'current', label: '现状', l: 0.648, c: 0.139, h: 148.2 },
  { id: 'g1', label: '1 柔和草绿', l: 0.69, c: 0.105, h: 150 },
  { id: 'g2', label: '2 薄荷', l: 0.72, c: 0.1, h: 158 },
  { id: 'g3', label: '3 冷薄荷', l: 0.7, c: 0.09, h: 164 },
  { id: 'g4', label: '4 竹青', l: 0.68, c: 0.11, h: 160 },
  { id: 'g5', label: '5 碧绿', l: 0.66, c: 0.1, h: 168 },
  { id: 'g6', label: '6 雾绿', l: 0.7, c: 0.075, h: 158 },
  { id: 'g7', label: '7 青瓷', l: 0.72, c: 0.075, h: 172 },
  { id: 'g8', label: '8 湖绿', l: 0.7, c: 0.085, h: 180 },
  { id: 'g9', label: '9 豆青', l: 0.75, c: 0.065, h: 162 },
  { id: 'g10', label: '10 松石淡', l: 0.74, c: 0.08, h: 186 },
  { id: 'g11', label: '11 雾松', l: 0.64, c: 0.075, h: 162 },
  { id: 'g12', label: '12 深碧', l: 0.6, c: 0.09, h: 170 },
];

const DARK_SURFACE = hexToOklch('#262626');

export interface GreenRamp {
  readonly brand: Oklch;
  readonly solid: Oklch;
  readonly text: Oklch;
  readonly tint: Oklch;
  readonly darkAccent: Oklch;
  readonly darkText: Oklch;
  readonly darkTint: Oklch;
  readonly solidContrast: number;
}

/** 浅色主按钮白字 ≥4.5:1；深色强调色在 #262626 上 ≥4.5:1。 */
export function greenRamp({ l, c, h }: GreenCandidate | Oklch): GreenRamp {
  const brand = { l, c, h };
  const solid = fitLightness({ l: Math.min(l - 0.1, 0.6), c: c * 0.92, h }, WHITE, 4.6, 'darker');
  const text = { l: solid.l - 0.05, c: c * 0.85, h };
  const darkAccent = fitLightness({ l: Math.max(l, 0.66), c, h }, DARK_SURFACE, 4.6, 'lighter');
  return {
    brand,
    solid,
    text,
    tint: { l: 0.95, c: c * 0.2, h },
    darkAccent,
    darkText: { l: 0.84, c: c * 0.6, h },
    darkTint: { l: 0.34, c: c * 0.4, h },
    solidContrast: contrast(solid, WHITE),
  };
}

export function accentTokens(theme: PreviewTheme, candidate: GreenCandidate | Oklch): TokenMap {
  const ramp = greenRamp(candidate);
  const { c, h } = ramp.brand;
  const solidHover = { ...ramp.solid, l: ramp.solid.l - 0.05 };
  const common = {
    'accent-solid': css(ramp.solid),
    'accent-solid-hover': css(solidHover),
    'accent-hover': css(solidHover),
  };
  if (theme === 'light') {
    return {
      ...common,
      accent: css(ramp.solid),
      'focus-ring': css(ramp.solid),
      'accent-text': css(ramp.text),
      'accent-light': css(ramp.brand),
      'accent-bg': css(ramp.tint),
      'accent-bg-hover': css({ l: 0.925, c: c * 0.26, h }),
      'accent-bg-subtle': css({ l: 0.977, c: c * 0.09, h }),
      'border-accent-light': css({ l: 0.82, c: c * 0.6, h }),
    };
  }
  return {
    ...common,
    accent: css(ramp.darkAccent),
    'focus-ring': css(ramp.darkAccent),
    'accent-text': css(ramp.darkText),
    'accent-light': css({ ...ramp.darkAccent, l: ramp.darkAccent.l - 0.03 }),
    'accent-bg': css(ramp.darkTint),
    'accent-bg-hover': css({ l: 0.38, c: c * 0.45, h }),
    'accent-bg-subtle': css({ l: 0.29, c: c * 0.3, h }),
    'border-accent-light': css({ l: 0.75, c: c * 0.6, h }),
  };
}

/** 墨色操作：主按钮、勾选、焦点改墨色，绿色只留给品牌与成功。 */
export const INK_TOKENS: Readonly<Record<PreviewTheme, TokenMap>> = {
  light: {
    accent: '#262626', 'accent-solid': '#2d2d2d', 'accent-solid-hover': '#171717', 'accent-hover': '#171717',
    'accent-text': '#262626', 'accent-bg': '#ededed', 'accent-bg-hover': '#e5e5e5', 'accent-bg-subtle': '#f5f5f5',
    'accent-light': '#525252', 'border-accent-light': '#bcbcbc', 'focus-ring': '#737373', 'text-on-accent': '#ffffff',
  },
  dark: {
    accent: '#e5e5e5', 'accent-solid': '#e5e5e5', 'accent-solid-hover': '#fafafa', 'accent-hover': '#fafafa',
    'accent-text': '#ededed', 'accent-bg': '#3a3a3a', 'accent-bg-hover': '#404040', 'accent-bg-subtle': '#2d2d2d',
    'accent-light': '#d4d4d4', 'border-accent-light': '#737373', 'focus-ring': '#a3a3a3', 'text-on-accent': '#171717',
  },
};
