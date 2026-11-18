import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ProbeError, repoRoot } from '../definitions/probeContract.mjs';
import { rendererStore } from '../functions/rendererStore.mjs';
import { UPDATE_FIXTURE_STATUSES, updateFixtureSnapshot } from '../functions/updateStateFixture.mjs';
import { evaluate, waitFor } from '../infrastructure/cdpClient.mjs';

const exec = promisify(execFile);
const projectName = 'Probe 项目概览夹具';
const files = [
  ['资料/行业报告.md', '# 行业报告\n\n储能需求增长。'],
  ['资料/访谈/纪要.md', '# 访谈纪要\n\n问题和结论。'],
  ['计划.md', '# 计划\n\n整理下一步。'],
  ['资料/演示稿.slides', 'compose({ title: "Probe", slides: [createSlide()] });'],
];

const fixtureUsage = 'fixture project-overview，或 fixture update-state <状态>';

/** 标题栏更新入口的各种外观：把 Main 快照写进 Renderer 的 update store，等入口出现或消失。 */
async function installUpdateState(connectPage, [status, ...rest]) {
  if (!UPDATE_FIXTURE_STATUSES.includes(status) || rest.length) {
    throw new ProbeError('USAGE', 'update-state 需要一个状态', `可选 ${UPDATE_FIXTURE_STATUSES.join(' / ')}；idle 表示没有更新`);
  }
  const { version } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const updateState = updateFixtureSnapshot(status, { currentVersion: version });
  const { cdp } = await connectPage();
  try {
    await evaluate(cdp, `${rendererStore('update')}.setState(${JSON.stringify(updateState)})`);
    const shown = status !== 'idle';
    await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('.app-header .app-update-entry')) === ${shown}`),
      shown ? '更新入口出现' : '更新入口消失', 5_000);
    return { updateState, note: '只改 Renderer 镜像；reload 后回到 Main 的真实状态' };
  } finally {
    cdp.close();
  }
}

export async function installFixture(session, positionals, { connectPage }) {
  if (session.options.entry) throw new ProbeError('USAGE', `${fixtureUsage}，只用于真实探针实例`);
  if (positionals[0] === 'update-state') return installUpdateState(connectPage, positionals.slice(1));
  if (positionals.length !== 1 || positionals[0] !== 'project-overview') throw new ProbeError('USAGE', `fixture 仅支持 ${fixtureUsage}`);
  const cli = async (...args) => {
    const { stdout } = await exec('pnpm', ['-s', 'linnya:cli', ...args], {
      cwd: repoRoot, env: { ...process.env, LINNYA_CLI_CONNECTION_FILE: session.connectionFile },
      timeout: 30_000,
    });
    const result = JSON.parse(stdout);
    if (!result.ok) throw new ProbeError('FIXTURE_FAILED', JSON.stringify(result.error));
    return result;
  };
  const { projects } = await cli('projects', 'list');
  if (projects.some(project => project.name === projectName)) {
    throw new ProbeError('FIXTURE_EXISTS', '夹具项目已存在', '可直接打开项目，或使用一个新的 --name 实例');
  }
  const { project } = await cli('projects', 'create', projectName);
  for (const [path, content] of files) {
    await cli('tools', 'call', 'write_file', '--project', project.project_id,
      '--args-json', JSON.stringify({ locator: `workspace:/${path}`, content }));
  }
  return { projectId: project.project_id, projectName, documents: files.length };
}
