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

export type ButtonMode = 'deep' | 'brand-dark' | 'brand-white' | 'ink' | 'tonal';

export interface ButtonStyle {
  readonly bg: Oklch;
  readonly fg: Oklch;
  readonly hover: Oklch;
}

const INK_LIGHT: ButtonStyle = { bg: hexToOklch('#2d2d2d'), fg: WHITE, hover: hexToOklch('#171717') };
const INK_DARK: ButtonStyle = { bg: hexToOklch('#e5e5e5'), fg: hexToOklch('#171717'), hover: hexToOklch('#fafafa') };

/**
 * 主按钮的五种做法：
 * - deep：现状，实底比品牌色深，保证白字 4.5:1；
 * - brand-dark：品牌色本色作实底、同色相深色字（Radix 对薄荷、天蓝、黄等亮色 step 9 的做法）；
 * - brand-white：品牌色本色加白字（Apple 系统绿的做法），白字对比度不足 4.5:1；
 * - ink：墨色主按钮，绿色只用于选中、勾选、状态；
 * - tonal：品牌色浅底加深色字（Material 3 浅色调按钮）。
 */
export function buttonStyle(theme: PreviewTheme, candidate: GreenCandidate | Oklch, mode: ButtonMode): ButtonStyle {
  const ramp = greenRamp(candidate);
  const { c, h } = ramp.brand;
  const brandFill = theme === 'light' ? ramp.brand : { ...ramp.brand, l: Math.max(ramp.brand.l, 0.7) };
  switch (mode) {
    case 'brand-dark':
      return { bg: brandFill, fg: { l: 0.25, c: c * 0.5, h }, hover: { ...brandFill, l: brandFill.l - 0.04 } };
    case 'brand-white':
      return { bg: brandFill, fg: WHITE, hover: { ...brandFill, l: brandFill.l - 0.04 } };
    case 'ink':
      return theme === 'light' ? INK_LIGHT : INK_DARK;
    case 'tonal':
      return theme === 'light'
        ? { bg: { l: 0.925, c: c * 0.32, h }, fg: ramp.text, hover: { l: 0.9, c: c * 0.4, h } }
        : { bg: { l: 0.38, c: c * 0.5, h }, fg: ramp.darkText, hover: { l: 0.42, c: c * 0.55, h } };
    default:
      return theme === 'light'
        ? { bg: ramp.solid, fg: WHITE, hover: { ...ramp.solid, l: ramp.solid.l - 0.05 } }
        : { bg: ramp.solid, fg: WHITE, hover: { ...ramp.solid, l: ramp.solid.l - 0.05 } };
  }
}

/** 预览容器上的按钮与标记变量；brand-* 模式下勾选、开关、页签指示也用品牌色本色。 */
export function buttonTokens(theme: PreviewTheme, candidate: GreenCandidate | Oklch, mode: ButtonMode): TokenMap {
  const style = buttonStyle(theme, candidate, mode);
  const tokens: TokenMap = {
    'preview-btn-bg': css(style.bg),
    'preview-btn-fg': css(style.fg),
    'preview-btn-hover': css(style.hover),
  };
  if (mode === 'brand-dark' || mode === 'brand-white') {
    tokens['preview-mark'] = css(style.bg);
    tokens['preview-mark-fg'] = css(style.fg);
  }
  return tokens;
}

export function buttonContrast(theme: PreviewTheme, candidate: GreenCandidate | Oklch, mode: ButtonMode): number {
  const style = buttonStyle(theme, candidate, mode);
  return contrast(style.bg, style.fg);
}
