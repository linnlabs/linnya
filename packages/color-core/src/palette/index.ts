export type {
  CheckPaletteInput,
  HueRange,
  Palette,
  PaletteBase,
  PaletteCheckResult,
  PaletteCheckRule,
  PaletteDraft,
  PaletteFailure,
  PaletteFinding,
  PaletteImagePixels,
  PaletteRelation,
  PaletteSuggestion,
  PaletteTone,
  SubjectColor,
  SuggestPalettesInput,
} from './definitions/palette.js'
export { colorFamily, hueName, hueRangeLabel, PALETTE_TONE_NAMES, subjectColorName } from './definitions/hueNames.js'
export { checkPalette } from './functions/checkPalette.js'
export { describePalette, type PaletteLook } from './functions/describePalette.js'
export { isColorExcluded } from './functions/excludedHues.js'
export { paletteDistance, paletteFamilies } from './functions/scorePalette.js'
export { decodeRngId, encodeRngId } from './functions/random.js'
export { MAX_PALETTE_IMAGES, suggestPalettes } from './orchestration/suggestPalettes.js'
