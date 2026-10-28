import type { DecisionConditionalAdvice } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';
import type { simulateDecisionScenarios } from './simulateDecisionScenarios';
import { formatDecisionClock, formatDecisionQuantity } from './formatDecisionQuantity';

type Simulation = ReturnType<typeof simulateDecisionScenarios>;

function textNumbers(text: string) {
  const clocks = new Set<string>();
  // 钟点整体识别后移除，不能把09:15中的9和15再当作金额或人数。
  const withoutClocks = text.replace(/(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g, (_match, hours: string, minutes: string) => {
    clocks.add(`${hours.padStart(2, '0')}:${minutes}`);
    return ' ';
  });
  const integers = new Set<number>();
  for (const match of withoutClocks.matchAll(/[+−-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE][+−-]?\d+)?/g)) {
    // 完整消费小数／指数后略过，不能从.6或1e-555内部偷取6、555。
    if (/[.eE]/.test(match[0])) continue;
    const value = Number(match[0].replace(/,/g, '').replace('−', '-'));
    if (Number.isSafeInteger(value)) integers.add(Math.abs(value));
  }
  return { clocks, integers };
}

/** 只检查明确声明的当天时刻；金额、人数、耗时等同值对象不能靠数字共现硬拦。 */
export function validateScenarioTextNumbers(advice: DecisionConditionalAdvice, simulation: Pick<Simulation, 'baseline' | 'cases'>): void {
  const conflicts: string[] = [];
  for (const scenario of simulation.cases) {
    const authorCase = advice.cases?.find(item => item.id === scenario.id);
    if (!authorCase) throw new Error(`Missing author scenario: ${scenario.id}`);
    const mentioned = textNumbers(`${authorCase.label}\n${authorCase.nextAction ?? ''}`);
    const contains = (value: number, unit: string | undefined) => {
      const clock = formatDecisionClock(value, unit);
      return mentioned.integers.has(Math.abs(value)) || (clock !== null && mentioned.clocks.has(clock));
    };
    const compare = (kind: string, id: string, baseline: number, actual: number, unit?: string) => {
      if (unit !== '当天00:00起分钟') return;
      // 不截断小数、不认证符号；绝对值相同时该规则没有分辨力。
      if (!Number.isSafeInteger(baseline) || !Number.isSafeInteger(actual) || Math.abs(baseline) === Math.abs(actual)) return;
      if (contains(baseline, unit) && !contains(actual, unit)) {
        conflicts.push(`scenario ${scenario.id}, ${kind} ${id}: wrote baseline ${formatDecisionQuantity(baseline, unit)}; scenario program value ${formatDecisionQuantity(actual, unit)}`);
      }
    };
    for (const change of scenario.changes) {
      if (change.status === 'available' && typeof change.from === 'number' && typeof change.to === 'number') {
        compare('input', change.inputId, change.from, change.to, change.unit);
      }
    }
    for (const calculation of scenario.evaluation.calculations) {
      const baseline = simulation.baseline.calculations.find(item => item.id === calculation.id);
      if (baseline?.result.status === 'available' && calculation.result.status === 'available') {
        compare('calculation', calculation.id, baseline.result.value, calculation.result.value, calculation.unit);
      }
    }
  }
  if (conflicts.length) {
    throw new DecisionFailure('scenario_text_mismatch', `${conflicts.join('\n')}\nCorrect label/nextAction for these cases before saving. Only declared day-clock values in these fields were checked; amounts, other advice, plans and final documents were not checked.`);
  }
}
