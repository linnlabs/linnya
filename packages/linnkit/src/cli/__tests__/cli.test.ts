import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../args';
import { runCli } from '../index';
import { runInitCommand } from '../init';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'linnkit-cli-'));
}

function createMockConfigSource(answer: string): string {
  return `
const agent = {
  spec: {
    id: 'hello',
    version: '0.1.0',
    capabilities: ['agent'],
    tools: [],
    contextPolicy: { profileId: 'agent' },
  },
  systemPrompt: 'You are helpful.',
  modelId: 'scripted',
  tools: [],
};

const inference = {
  async *stream(request) {
    yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
    yield { type: 'answer_delta', text: ${JSON.stringify(answer)} };
    yield {
      type: 'usage',
      usage: {
        inputTokens: 4,
        outputTokens: 3,
        totalTokens: 7,
        source: 'provider-response-usage',
        confidence: 'actual',
      },
    };
    yield { type: 'finish', reason: 'stop' };
  },
};

export default {
  agents: [agent],
  defaultModelId: 'scripted',
  inference,
};
`;
}

describe('linnkit cli', () => {
  it('解析 init/run/doctor 参数', () => {
    expect(parseCliArgs(['run', 'hello', '--input', 'hi', '--model=demo'])).toEqual({
      command: 'run',
      positional: ['hello'],
      options: { input: 'hi', model: 'demo' },
    });
  });

  it('init 生成 quickstart 项目且不覆盖非空目录', async () => {
    const cwd = await createTempDir();
    const files = await runInitCommand({ cwd, name: 'demo' });

    expect(files).toContain('package.json');
    expect(files).toContain('linnkit.config.mjs');
    expect(files).not.toContain('.npmrc.example');
    const generatedPackageJson: unknown = JSON.parse(await readFile(join(cwd, 'demo', 'package.json'), 'utf8'));
    if (!isRecord(generatedPackageJson) || !isRecord(generatedPackageJson.dependencies)) {
      throw new Error('generated quickstart package.json must define dependencies.');
    }
    expect(generatedPackageJson.dependencies['@linnlabs/linnkit']).toBe('^0.16.0');
    expect(generatedPackageJson.dependencies['ai']).toBe('^7.0.65');
    expect(generatedPackageJson.dependencies['@ai-sdk/openai']).toBe('^4.0.41');
    const adapter = await readFile(join(cwd, 'demo', 'adapters', 'ai-sdk-openai.mjs'), 'utf8');
    expect(adapter).toContain('createProviderRegistry');
    expect(adapter).toContain('maxRetries: 0');
    expect(adapter).not.toContain('createServerSentEventFrameParser');
    await expect(runInitCommand({ cwd, name: 'demo' })).rejects.toThrow(/not empty/);
  });

  it('doctor 能加载 mock config 并给出成功报告', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'linnkit.config.mjs'), createMockConfigSource('ok'), 'utf8');
    await writeFile(join(cwd, '.env'), 'OPENAI_API_KEY=test\n', 'utf8');
    let stdout = '';

    const exitCode = await runCli(
      ['doctor'],
      cwd,
      (text) => {
        stdout += text;
      },
      () => undefined,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('✓ config linnkit.config.mjs');
    expect(stdout).toContain('✓ canonical inference port');
    expect(stdout).toContain('✓ npmjs public registry');
  });

  it('doctor 会提示删除旧 GitHub Packages registry override', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'linnkit.config.mjs'), createMockConfigSource('ok'), 'utf8');
    await writeFile(join(cwd, '.env'), 'OPENAI_API_KEY=test\n', 'utf8');
    await writeFile(join(cwd, '.npmrc'), '@linnlabs:registry=https://npm.pkg.github.com/\n', 'utf8');
    let stdout = '';

    const exitCode = await runCli(
      ['doctor'],
      cwd,
      (text) => {
        stdout += text;
      },
      () => undefined,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('! .npmrc legacy GitHub Packages registry');
    expect(stdout).toContain('remove the @linnlabs registry override');
  });

  it('run 使用 mock config 跑出 final answer 和 cost', async () => {
    const cwd = await createTempDir();
    await writeFile(join(cwd, 'linnkit.config.mjs'), createMockConfigSource('hello from cli'), 'utf8');
    let stdout = '';

    const exitCode = await runCli(
      ['run', 'hello', '--input', 'hi'],
      cwd,
      (text) => {
        stdout += text;
      },
      () => undefined,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('hello from cli');
    expect(stdout).toContain('tokens input=4 output=3');
  });

  it('run 缺 input 时返回友好错误', async () => {
    const cwd = await createTempDir();
    let stderr = '';

    const exitCode = await runCli(
      ['run', 'hello'],
      cwd,
      () => undefined,
      (text) => {
        stderr += text;
      },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain('run requires --input');
  });
});
