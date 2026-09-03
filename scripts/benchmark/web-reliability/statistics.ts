export interface ReliabilityAttempt {
  eligible: boolean;
  success: boolean;
}

export interface ReliabilityGateResult {
  eligibleAttempts: number;
  excludedAttempts: number;
  successes: number;
  observedRate: number;
  wilsonLowerBound: number;
  hasEnoughSamples: boolean;
  passed: boolean;
}

function inverseNormalCdf(probability: number): number {
  if (!(probability > 0 && probability < 1)) throw new Error('probability 必须在 0 与 1 之间。');

  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;
  const high = 1 - low;

  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function wilsonLowerBound(successes: number, attempts: number, confidence = 0.95): number {
  if (!Number.isInteger(successes) || !Number.isInteger(attempts) || successes < 0 || attempts < 0 || successes > attempts) {
    throw new Error('successes/attempts 必须是满足 0 <= successes <= attempts 的整数。');
  }
  if (attempts === 0) return 0;
  if (!(confidence > 0 && confidence < 1)) throw new Error('confidence 必须在 0 与 1 之间。');

  const z = inverseNormalCdf(1 - (1 - confidence) / 2);
  const rate = successes / attempts;
  const zSquared = z * z;
  const denominator = 1 + zSquared / attempts;
  const centre = rate + zSquared / (2 * attempts);
  const margin = z * Math.sqrt((rate * (1 - rate) + zSquared / (4 * attempts)) / attempts);
  return (centre - margin) / denominator;
}

export function evaluateReliabilityGate(
  attempts: ReliabilityAttempt[],
  options: { minAttempts?: number; targetLowerBound?: number; confidence?: number } = {},
): ReliabilityGateResult {
  const eligible = attempts.filter((attempt) => attempt.eligible);
  const successes = eligible.filter((attempt) => attempt.success).length;
  const minAttempts = options.minAttempts ?? 200;
  const targetLowerBound = options.targetLowerBound ?? 0.95;
  const lowerBound = wilsonLowerBound(successes, eligible.length, options.confidence ?? 0.95);
  const hasEnoughSamples = eligible.length >= minAttempts;

  return {
    eligibleAttempts: eligible.length,
    excludedAttempts: attempts.length - eligible.length,
    successes,
    observedRate: eligible.length > 0 ? successes / eligible.length : 0,
    wilsonLowerBound: lowerBound,
    hasEnoughSamples,
    passed: hasEnoughSamples && lowerBound >= targetLowerBound,
  };
}
