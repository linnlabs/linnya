import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const entry = path.join(repoRoot, 'apps/linnya-benchmark/src/main.ts');

function runProcess(args: readonly string[]) {
  return new Promise<{
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entry, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', exitCode => resolve({ exitCode, stdout, stderr }));
  });
}

describe('linnya-benchmark real CLI process', () => {
  it('list 从内置 registry 输出全部已注册 case，不连接 App', async () => {
    const result = await runProcess(['list']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const response = JSON.parse(result.stdout) as {
      schema_version: number;
      cases: Array<{
        id: string;
        revision: number;
        agent_id: string;
        inputs: Array<{ key: string; kind: string }>;
      }>;
    };
    expect(response).toMatchObject({
      schema_version: 1,
    });
    expect(response.cases.map(item => item.id)).toEqual([
      'slides_consulting_commercial_space_v1',
      'slides_consulting_energy_storage_v1',
      'slides_consulting_high_density_v1',
      'slides_consulting_humanoid_robotics_v1',
      'slides_consulting_innovative_pharma_v1',
      'slides_consulting_reference_v1',
      'slides_design_contract_baseline_v1',
      'slides_design_contract_intent_v1',
    ]);
    for (const benchmarkCase of response.cases) {
      if (benchmarkCase.id.startsWith('slides_design_contract_')) {
        expect(benchmarkCase.inputs).toEqual([]);
        continue;
      }
      expect(benchmarkCase).toMatchObject({
        revision: expect.any(Number),
        agent_id: 'slides_agent',
        inputs: [{ key: 'reference_image', kind: 'absolute_file' }],
      });
    }
  });

  it('run 缺少 case 输入时在启动 Linnya CLI 前返回参数错误', async () => {
    const result = await runProcess([
      'run', 'slides_consulting_reference_v1', '--project', 'project-1',
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: { code: 'invalid_request', message: 'Missing required input: reference_image' },
    });
  });
});
