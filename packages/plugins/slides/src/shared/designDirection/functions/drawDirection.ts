import { IMAGELESS_IMAGE_STRATEGY_IDS } from '../definitions/directionContract';
import type {
  ColorLogicId,
  DirectionAxisOption,
  DirectionBoldness,
  DirectionDraw,
  DirectionMotif,
  DirectionScenario,
  HueBin,
  ImageStrategyId,
  TechniqueCard,
  TypeStrategyId,
} from '../definitions/directionContract';
import {
  ATTRACTOR_COLOR_LOGIC_FACTOR,
  ATTRACTOR_HUE_BINS,
  ATTRACTOR_HUE_FACTOR,
  BOLDNESS_WEIGHTS,
  COLOR_LOGICS,
  COVER_COMPOSITION_FACTORS,
  COVER_COMPOSITIONS,
  DEFAULT_BOLDNESS_BY_SCENARIO,
  HUE_BINS,
  HUELESS_COLOR_LOGICS,
  IMAGE_DEPENDENT_COVER_COMPOSITIONS,
  IMAGE_STRATEGIES,
  SCENARIO_HUE_FACTORS,
  TYPE_STRATEGIES,
} from '../pool/axes';
import { TECHNIQUE_CARDS } from '../pool/techniqueCards';

/** 签池版本：卡片、轴或权重改动时递增，用于基准对账。 */
/** 主色相对面：与 color-core 的 OPPOSITE_HUE_FROM/TO 一致（这里会打进 build Worker，不引入 color-core）。 */
const OPPOSITE_HUE_FROM_DEG = 150;
const OPPOSITE_HUE_TO_DEG = 210;

export const DIRECTION_POOL_VERSION = '2026-11-10.1';

/** 本机最近用过的方向，用来降权，避免同一个人连续拿到同一种手法。 */
export interface DirectionHistory {
  /** 由近到远。 */
  readonly cardIds: readonly string[];
  readonly hueBins: readonly number[];
}

export interface DrawDirectionInput {
  readonly scenario: DirectionScenario;
  readonly boldness?: DirectionBoldness;
  readonly motifs: readonly DirectionMotif[];
  readonly seed: string;
  readonly history?: DirectionHistory;
  /** 配置了生图模型时，“生成插画”才进入抽签。 */
  readonly imageModelAvailable?: boolean;
  /** 稿子必须有图片：不发基本无图的图片策略，也不发只有这类策略的手法卡。 */
  readonly requireImages?: boolean;
  /** 一次抽几张；同一批之间至少两个主轴不同。 */
  readonly count?: number;
  /** Agent 写明理由退回的手法，本次不再发出。 */
  readonly excludeCardIds?: readonly string[];
  readonly cards?: readonly TechniqueCard[];
}

const RECENT_CARD_WINDOW = 5;
const RECENT_CARD_FACTOR = 0.15;
const OLDER_CARD_WINDOW = 15;
const OLDER_CARD_FACTOR = 0.5;
const RECENT_HUE_WINDOW = 3;
const RECENT_HUE_FACTOR = 0.4;
const MAX_BATCH_ATTEMPTS = 40;

export function drawDirections(input: DrawDirectionInput): DirectionDraw[] {
  const count = Math.max(1, Math.min(3, input.count ?? 1));
  const random = createSeededRandom(input.seed);
  const boldness = input.boldness ?? DEFAULT_BOLDNESS_BY_SCENARIO[input.scenario];
  const cards = input.cards ?? TECHNIQUE_CARDS;
  const history = input.history ?? { cardIds: [], hueBins: [] };
  const draws: DirectionDraw[] = [];
  const usedMotifs = new Set<string>();

  for (let index = 0; index < count; index += 1) {
    let draw: DirectionDraw | null = null;
    for (let attempt = 0; attempt < MAX_BATCH_ATTEMPTS && draw == null; attempt += 1) {
      const candidate = drawOne(input, cards, boldness, history, random, draws, usedMotifs, index);
      if (candidate && isDistinctFromBatch(candidate, draws)) draw = candidate;
    }
    if (draw == null) break;
    draws.push(draw);
    if (draw.motif) usedMotifs.add(draw.motif);
  }
  if (draws.length === 0) {
    throw new Error(`签池里没有适用于场景 ${input.scenario} 的手法卡`);
  }
  return draws;
}

function drawOne(
  input: DrawDirectionInput,
  cards: readonly TechniqueCard[],
  boldness: DirectionBoldness,
  history: DirectionHistory,
  random: () => number,
  batch: readonly DirectionDraw[],
  usedMotifs: ReadonlySet<string>,
  index: number,
): DirectionDraw | null {
  const batchCardIds = new Set(batch.map((draw) => draw.card.id));
  const card = pickWeighted(random, cards, (candidate) => {
    if (batchCardIds.has(candidate.id) || input.excludeCardIds?.includes(candidate.id)) return 0;
    const scenarioWeight = candidate.scenarios[input.scenario] ?? 0;
    if (scenarioWeight === 0) return 0;
    if (!candidate.imageStrategies.some((id) => isImageStrategyAllowed(id, input))) return 0;
    return scenarioWeight
      * BOLDNESS_WEIGHTS[boldness][candidate.boldness - 1]!
      * historyFactor(candidate.id, history.cardIds);
  });
  if (card == null) return null;

  const colorLogic = pickAxis(random, COLOR_LOGICS, card.colorLogics, (id) => ATTRACTOR_COLOR_LOGIC_FACTOR[id] ?? 1);
  const typeStrategy = pickAxis(random, TYPE_STRATEGIES, card.typeStrategies, () => 1);
  const imageStrategy = pickAxis(random, IMAGE_STRATEGIES, card.imageStrategies, (id) =>
    isImageStrategyAllowed(id, input) ? 1 : 0);
  if (colorLogic == null || typeStrategy == null || imageStrategy == null) return null;
  const imageless = IMAGELESS_IMAGE_STRATEGY_IDS.includes(imageStrategy.id);
  const coverComposition = pickWeighted(random, COVER_COMPOSITIONS, (option) =>
    (imageless && IMAGE_DEPENDENT_COVER_COMPOSITIONS.includes(option.id) ? 0 : 1)
    * (COVER_COMPOSITION_FACTORS[option.id] ?? 1)
    * (batch.some((draw) => draw.coverComposition.id === option.id) ? 0.2 : 1));
  if (coverComposition == null) return null;

  const hue = HUELESS_COLOR_LOGICS.includes(colorLogic.id)
    ? null
    : pickWeighted(random, HUE_BINS, (bin) =>
        (SCENARIO_HUE_FACTORS[input.scenario]?.[bin.bin] ?? 1)
        * (ATTRACTOR_HUE_BINS.includes(bin.bin) ? ATTRACTOR_HUE_FACTOR : 1)
        * (history.hueBins.slice(0, RECENT_HUE_WINDOW).includes(bin.bin) ? RECENT_HUE_FACTOR : 1)
        * (batch.some((draw) => draw.hue?.bin === bin.bin) ? 0.2 : 1));

  return {
    drawId: `${input.seed}-${index + 1}`,
    seed: input.seed,
    poolVersion: DIRECTION_POOL_VERSION,
    scenario: input.scenario,
    boldness,
    card,
    colorLogic,
    hue: hue ?? null,
    hueReference: hue ? hue.references[Math.floor(random() * hue.references.length)] ?? hue.references[1] : null,
    oppositeHues: hue ? findOppositeHueBins(hue) : [],
    typeStrategy,
    imageStrategy,
    coverComposition,
    motif: pickMotif(random, input.motifs, usedMotifs),
  };
}

function isImageStrategyAllowed(id: ImageStrategyId, input: DrawDirectionInput): boolean {
  if (id === 'generated-illustration' && input.imageModelAvailable !== true) return false;
  if (input.requireImages === true && IMAGELESS_IMAGE_STRATEGY_IDS.includes(id)) return false;
  return true;
}

function historyFactor(cardId: string, recent: readonly string[]): number {
  const position = recent.indexOf(cardId);
  if (position < 0) return 1;
  if (position < RECENT_CARD_WINDOW) return RECENT_CARD_FACTOR;
  if (position < OLDER_CARD_WINDOW) return OLDER_CARD_FACTOR;
  return 1;
}

function pickAxis<TId extends ColorLogicId | TypeStrategyId | ImageStrategyId>(
  random: () => number,
  options: readonly DirectionAxisOption<TId>[],
  allowed: readonly TId[],
  factor: (id: TId) => number,
): DirectionAxisOption<TId> | null {
  return pickWeighted(random, options, (option) => (allowed.includes(option.id) ? factor(option.id) : 0));
}

/** 越常见的母题越不容易被挑中；同一批不重复。 */
function pickMotif(
  random: () => number,
  motifs: readonly DirectionMotif[],
  used: ReadonlySet<string>,
): string | null {
  const picked = pickWeighted(random, motifs, (motif) =>
    used.has(motif.text) ? 0 : (1 - motif.typicality) ** 2 + 0.05);
  return picked?.text ?? null;
}

function isDistinctFromBatch(candidate: DirectionDraw, batch: readonly DirectionDraw[]): boolean {
  return batch.every((other) => {
    let differences = 0;
    if (other.card.family !== candidate.card.family) differences += 1;
    if (other.colorLogic.id !== candidate.colorLogic.id) differences += 1;
    if (other.imageStrategy.id !== candidate.imageStrategy.id) differences += 1;
    return differences >= 2;
  });
}

function pickWeighted<T>(random: () => number, items: readonly T[], weight: (item: T) => number): T | null {
  let total = 0;
  const weights = items.map((item) => {
    const value = Math.max(0, weight(item));
    total += value;
    return value;
  });
  if (total <= 0) return null;
  let cursor = random() * total;
  for (let index = 0; index < items.length; index += 1) {
    cursor -= weights[index]!;
    if (cursor < 0) return items[index]!;
  }
  return items[items.length - 1] ?? null;
}

/** 由字符串种子得到可复现的 [0,1) 随机序列（cyrb53 + mulberry32）。 */
export function createSeededRandom(seed: string): () => number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  let state = h1 >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 主色相对面的几档：色相差 150°–210° 的弧覆盖一半以上的档。与 color-core 排除区同一口径。 */
export function findOppositeHueBins(hue: HueBin): HueBin[] {
  const width = (hue.to - hue.from + 360) % 360;
  const center = hue.from + width / 2;
  const arcFrom = center + OPPOSITE_HUE_FROM_DEG;
  return HUE_BINS.filter((entry) => {
    const entryWidth = (entry.to - entry.from + 360) % 360;
    let covered = 0;
    for (let step = 0; step < entryWidth; step += 1) {
      const degree = entry.from + step + 0.5;
      if ((((degree - arcFrom) % 360) + 360) % 360 <= OPPOSITE_HUE_TO_DEG - OPPOSITE_HUE_FROM_DEG) covered += 1;
    }
    return covered * 2 > entryWidth;
  });
}

export function findHueBin(bin: number): HueBin | undefined {
  return HUE_BINS.find((entry) => entry.bin === bin);
}
