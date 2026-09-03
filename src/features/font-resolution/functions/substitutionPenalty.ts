import type { FontMetadata, FontRequest, ScriptClass } from '../definitions/types.js';
import { hasScriptCoverage } from './scriptCoverage.js';

export interface PenaltyWeights {
  /** 请求脚本无 unicode range 覆盖时的最高罚分。 */
  scriptCoverageMiss: number;
  /** PANOSE Family Kind 不同，说明字体大类不同。 */
  panoseFamilyKind: number;
  /** PANOSE 其余字节按距离累计的单位罚分。 */
  panosePerByte: number;
  /** 候选用 0（Any）省略请求侧已知 PANOSE 维度时的低置信罚分。 */
  panoseUnknownPerByte: number;
  fixedPitchMismatch: number;
  /** 平均字符宽度每 1% 偏差的罚分。 */
  avgWidthPerRatio: number;
  /** 候选没有正的 xAvgCharWidth 时，不能把它当作零宽度差异。 */
  avgWidthUnavailable: number;
  /** family/postscript name 无相似性时的罚分。 */
  nameMismatch: number;
  /** bold/italic 需要合成时的单项罚分。 */
  styleMismatch: number;
}

/** 初始权重只表达量级关系：脚本覆盖 >> 大类/缺失宽度 >> 等宽 >> 样式/宽度 >> 名称；具体数值继续由真实语料标定。 */
export const DEFAULT_PENALTY_WEIGHTS: PenaltyWeights = {
  scriptCoverageMiss: 100_000,
  panoseFamilyKind: 20_000,
  panosePerByte: 300,
  panoseUnknownPerByte: 1_000,
  fixedPitchMismatch: 8_000,
  avgWidthPerRatio: 400,
  avgWidthUnavailable: 20_000,
  nameMismatch: 1_000,
  // 真实语料证明 500 会让 regular face 仅凭轻微 metrics 优势击败已安装 bold face；
  // 字重/斜体身份应高于名称相似度和小幅平均宽度差异。
  styleMismatch: 5_000,
};

interface ReferenceFontProfile {
  panose: readonly number[];
  avgCharWidth: number;
  isFixedPitch: boolean;
}

const SCRIPT_BASELINE_AVG_WIDTH: Record<ScriptClass, number> = {
  latin: 0.5,
  eastAsian: 1,
  complex: 0.6,
};

const KNOWN_FONT_PROFILES: Readonly<Record<string, ReferenceFontProfile>> = {
  arial: {
    panose: [2, 11, 6, 4, 2, 2, 2, 2, 2, 4],
    avgCharWidth: 0.5,
    isFixedPitch: false,
  },
  calibri: {
    panose: [2, 15, 5, 2, 2, 2, 4, 3, 2, 4],
    avgCharWidth: 0.5,
    isFixedPitch: false,
  },
  consolas: {
    panose: [2, 11, 6, 9, 2, 2, 4, 3, 2, 4],
    avgCharWidth: 0.6,
    isFixedPitch: true,
  },
  couriernew: {
    panose: [2, 7, 3, 9, 2, 2, 5, 2, 4, 4],
    avgCharWidth: 0.6,
    isFixedPitch: true,
  },
  simsun: {
    panose: [2, 1, 6, 0, 3, 1, 1, 1, 1, 1],
    avgCharWidth: 1,
    isFixedPitch: false,
  },
  timesnewroman: {
    panose: [2, 2, 6, 3, 5, 4, 5, 2, 3, 4],
    avgCharWidth: 0.5,
    isFixedPitch: false,
  },
  yahei: {
    panose: [2, 11, 5, 3, 2, 2, 4, 2, 2, 4],
    avgCharWidth: 1,
    isFixedPitch: false,
  },
  microsoftyahei: {
    panose: [2, 11, 5, 3, 2, 2, 4, 2, 2, 4],
    avgCharWidth: 1,
    isFixedPitch: false,
  },
};

export function scoreSubstitution(
  request: FontRequest,
  candidate: FontMetadata,
  requestedMeta?: FontMetadata,
  weights: PenaltyWeights = DEFAULT_PENALTY_WEIGHTS,
): number {
  if (namesEqual(request.family, candidate.family) || namesEqual(request.family, candidate.postscriptName)) {
    return stylePenalty(request, candidate, weights);
  }

  const reference = referenceProfile(request, requestedMeta);
  let penalty = weights.nameMismatch * (1 - nameSimilarity(request.family, candidate.family, candidate.postscriptName));
  penalty += scriptCoveragePenalty(request.script, candidate, weights);
  penalty += panosePenalty(reference.panose, candidate.panose, weights);
  penalty += fixedPitchPenalty(reference.isFixedPitch, candidate, weights);
  penalty += avgWidthPenalty(reference.avgCharWidth, candidate, weights);
  penalty += stylePenalty(request, candidate, weights);
  return penalty;
}

function referenceProfile(request: FontRequest, requestedMeta: FontMetadata | undefined): ReferenceFontProfile {
  if (requestedMeta != null) {
    return {
      panose: requestedMeta.panose,
      avgCharWidth: requestedMeta.avgCharWidth,
      isFixedPitch: requestedMeta.isFixedPitch,
    };
  }

  const knownProfile = KNOWN_FONT_PROFILES[normalizeFontName(request.family)];
  if (knownProfile != null) {
    return knownProfile;
  }

  return {
    panose: [],
    avgCharWidth: SCRIPT_BASELINE_AVG_WIDTH[request.script],
    isFixedPitch: false,
  };
}

function scriptCoveragePenalty(script: ScriptClass, candidate: FontMetadata, weights: PenaltyWeights): number {
  return hasScriptCoverage(candidate, script) ? 0 : weights.scriptCoverageMiss;
}

function panosePenalty(referencePanose: readonly number[], candidatePanose: readonly number[], weights: PenaltyWeights): number {
  if (referencePanose.length === 0 || candidatePanose.length === 0) {
    return 0;
  }

  let penalty = 0;
  const referenceFamilyKind = referencePanose[0];
  const candidateFamilyKind = candidatePanose[0];
  if (referenceFamilyKind !== 0 && candidateFamilyKind !== 0 && referenceFamilyKind !== candidateFamilyKind) {
    penalty += weights.panoseFamilyKind;
  }

  const comparableLength = Math.min(referencePanose.length, candidatePanose.length);
  for (let index = 0; index < comparableLength; index += 1) {
    const referenceValue = referencePanose[index];
    const candidateValue = candidatePanose[index];
    if (referenceValue == null || candidateValue == null || referenceValue === 0) {
      continue;
    }
    if (candidateValue === 0) {
      penalty += weights.panoseUnknownPerByte;
      continue;
    }
    if (index === 0) continue;
    penalty += Math.abs(referenceValue - candidateValue) * weights.panosePerByte;
  }

  return penalty;
}

function fixedPitchPenalty(referenceFixedPitch: boolean, candidate: FontMetadata, weights: PenaltyWeights): number {
  return referenceFixedPitch === candidate.isFixedPitch ? 0 : weights.fixedPitchMismatch;
}

function avgWidthPenalty(referenceAvgCharWidth: number, candidate: FontMetadata, weights: PenaltyWeights): number {
  if (referenceAvgCharWidth <= 0) {
    return 0;
  }
  if (candidate.avgCharWidth <= 0) return weights.avgWidthUnavailable;
  const ratioDelta = Math.abs(candidate.avgCharWidth - referenceAvgCharWidth) / referenceAvgCharWidth;
  return ratioDelta * 100 * weights.avgWidthPerRatio;
}

function stylePenalty(request: FontRequest, candidate: FontMetadata, weights: PenaltyWeights): number {
  let penalty = 0;
  if (request.bold !== candidate.bold) {
    penalty += weights.styleMismatch;
  }
  if (request.italic !== candidate.italic) {
    penalty += weights.styleMismatch;
  }
  return penalty;
}

function nameSimilarity(requestedFamily: string, candidateFamily: string, candidatePostscriptName?: string): number {
  const requested = normalizeFontName(requestedFamily);
  const candidate = normalizeFontName(candidateFamily);
  const postscript = candidatePostscriptName == null ? '' : normalizeFontName(candidatePostscriptName);
  return Math.max(prefixSimilarity(requested, candidate), prefixSimilarity(requested, postscript));
}

function namesEqual(first: string, second: string): boolean {
  return normalizeFontName(first) === normalizeFontName(second);
}

function prefixSimilarity(first: string, second: string): number {
  if (first.length === 0 || second.length === 0) {
    return 0;
  }
  const maxLength = Math.max(first.length, second.length);
  let sharedPrefixLength = 0;
  while (
    sharedPrefixLength < first.length
    && sharedPrefixLength < second.length
    && first[sharedPrefixLength] === second[sharedPrefixLength]
  ) {
    sharedPrefixLength += 1;
  }
  return sharedPrefixLength / maxLength;
}

function normalizeFontName(fontName: string): string {
  const normalizedTokens = fontName
    .toLocaleLowerCase('en-US')
    .replace(/[\u3000\s_-]+/g, ' ')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !isIgnorableNameToken(token));
  return normalizedTokens.join('');
}

function isIgnorableNameToken(token: string): boolean {
  return token === 'regular'
    || token === 'mt'
    || token === 'ps'
    || token === 'std'
    || token === 'pro'
    || token === 'ui';
}
