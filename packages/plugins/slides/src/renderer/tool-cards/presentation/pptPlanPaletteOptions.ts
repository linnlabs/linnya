import { describePalette, type PaletteBase } from '@linnya/color-core/palette';
import type { DirectionPalette } from '@plugin/slides/shared/designDirection/definitions/directionContract';
import type {
  SlidesToolCardMessageKey,
  SlidesToolCardMessageResolver,
} from '../definitions/slidesToolCardMessageCatalog';
import type { PptPlanLookData } from './pptPlanInteraction';

const BASE_KEYS: Readonly<Record<PaletteBase, SlidesToolCardMessageKey>> = {
  light: 'slides.plan.look.base.light',
  tint: 'slides.plan.look.base.tint',
  dark: 'slides.plan.look.base.dark',
};

/** color-core 的色系名（中文）对应的界面文案。 */
const FAMILY_KEYS: Readonly<Record<string, SlidesToolCardMessageKey>> = {
  红: 'slides.plan.look.family.red',
  橙: 'slides.plan.look.family.orange',
  黄: 'slides.plan.look.family.yellow',
  绿: 'slides.plan.look.family.green',
  青: 'slides.plan.look.family.cyan',
  蓝: 'slides.plan.look.family.blue',
  紫: 'slides.plan.look.family.purple',
  品红: 'slides.plan.look.family.magenta',
  褐: 'slides.plan.look.family.brown',
  橄榄: 'slides.plan.look.family.olive',
};

/** 色条按页面上的大致面积分段：主底色最宽，其余底色、文字次之，强调色平分余下。 */
const MAIN_BACKGROUND_SHARE = 40;
const OTHER_BACKGROUNDS_SHARE = 14;
const INK_SHARE = 12;
const ACCENTS_SHARE = 34;

export interface PlanPaletteSegment {
  readonly color: string;
  readonly weight: number;
}

export interface PlanPaletteOption {
  /** null 是 Agent 选定的一套，数字是 look.alternatives 的下标。 */
  readonly index: number | null;
  readonly name: string;
  readonly segments: readonly PlanPaletteSegment[];
  /** 悬停时显示的色值。 */
  readonly colors: string;
}

/** 一套配色的名字，如“染纸 · 蓝配青”；只看颜色值，与配色建议的风格名同一口径。 */
export function formatPlanPaletteName(palette: DirectionPalette, message: SlidesToolCardMessageResolver): string {
  const look = describePalette(palette.backgrounds[0] ?? '', palette.accents);
  if (!look) return '';
  const families = look.families.map((family) => {
    const key = FAMILY_KEYS[family];
    return key ? message(key) : family;
  });
  const [first, second] = families;
  const familyText = first === undefined
    ? message('slides.plan.look.familyNone')
    : families.length === 2 && second !== undefined
      ? message('slides.plan.look.familyPair', { first, second })
      : families.join(message('slides.plan.look.familySeparator'));
  return message('slides.plan.look.paletteName', { base: message(BASE_KEYS[look.base]), families: familyText });
}

function segmentsOf(palette: DirectionPalette): PlanPaletteSegment[] {
  const [main, ...others] = palette.backgrounds;
  return [
    ...(main === undefined ? [] : [{ color: main, weight: MAIN_BACKGROUND_SHARE }]),
    ...others.map((color) => ({ color, weight: OTHER_BACKGROUNDS_SHARE / others.length })),
    { color: palette.ink, weight: INK_SHARE },
    ...palette.accents.map((color) => ({ color, weight: ACCENTS_SHARE / palette.accents.length })),
  ];
}

function optionOf(palette: DirectionPalette, index: number | null, message: SlidesToolCardMessageResolver): PlanPaletteOption {
  return {
    index,
    name: formatPlanPaletteName(palette, message),
    segments: segmentsOf(palette),
    colors: `${[...palette.backgrounds, palette.ink].join(' ')} | ${palette.accents.join(' ')}`,
  };
}

/** 计划卡并列显示的几套：选定的一套在前，备选按 Agent 给的顺序；没有备选时为空。 */
export function planPaletteOptions(look: PptPlanLookData, message: SlidesToolCardMessageResolver): PlanPaletteOption[] {
  if (!look.alternatives?.length) return [];
  return [
    optionOf(look.palette, null, message),
    ...look.alternatives.map((palette, index) => optionOf(palette, index, message)),
  ];
}
