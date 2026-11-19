import { describe, expect, it } from 'vitest';
import { parseScenarioArgs, scenarioEnv, ScenarioUsageError } from './parseScenarioArgs.mjs';
import { renderScenarioTest, scenarioTestPath } from './scenarioTemplates.mjs';

describe('scenario 命令参数', () => {
  it('默认列出场景；run 收集文件片段与用例名过滤', () => {
    expect(parseScenarioArgs([])).toMatchObject({ command: 'list' });
    expect(parseScenarioArgs(['run', 'steering', '--grep', '暂停', '--verbose']))
      .toEqual({ command: 'run', filters: ['steering'], options: { grep: '暂停', verbose: true } });
  });

  it('fuzz 与 replay 通过环境变量把次数、种子、路径交给随机组合测试', () => {
    expect(scenarioEnv(parseScenarioArgs(['fuzz', '--runs', '200', '--seed', '-7'])))
      .toEqual({ SCENARIO_QUIET: '1', SCENARIO_RUNS: '200', SCENARIO_SEED: '-7' });
    expect(scenarioEnv(parseScenarioArgs(['replay', '-99723186', '3'])))
      .toEqual({ SCENARIO_QUIET: '1', SCENARIO_SEED: '-99723186', SCENARIO_RUNS: '1', SCENARIO_PATH: '3' });
    expect(scenarioEnv(parseScenarioArgs(['run', '--verbose']))).toEqual({});
    expect(scenarioEnv(parseScenarioArgs(['run', 'real-model', '--real-model'])))
      .toEqual({ SCENARIO_QUIET: '1', LINNYA_REAL_MODEL_TEST: '1' });
  });

  it('拒绝未知命令、缺值参数和非法名字', () => {
    expect(() => parseScenarioArgs(['bogus'])).toThrow(ScenarioUsageError);
    expect(() => parseScenarioArgs(['fuzz', '--runs'])).toThrow(ScenarioUsageError);
    expect(() => parseScenarioArgs(['replay'])).toThrow(ScenarioUsageError);
    expect(() => parseScenarioArgs(['new', 'Bad Name'])).toThrow(ScenarioUsageError);
  });

  it('new 生成的骨架指向 Flow 集成测试目录并使用场景夹具', () => {
    expect(scenarioTestPath('steer-after-error'))
      .toBe('src/app-hosts/linnya/adapters/flow/__integration-tests__/flow.steer-after-error.scenario.integration.test.ts');
    expect(renderScenarioTest('steer-after-error')).toContain("describe('steer after error'");
    expect(renderScenarioTest('steer-after-error')).toContain('createFlowScenario(');
  });
});
