import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProbeError, repoRoot } from '../definitions/probeContract.mjs';

const exec = promisify(execFile);
const projectName = 'Probe 项目概览夹具';
const files = [
  ['资料/行业报告.md', '# 行业报告\n\n储能需求增长。'],
  ['资料/访谈/纪要.md', '# 访谈纪要\n\n问题和结论。'],
  ['计划.md', '# 计划\n\n整理下一步。'],
  ['资料/演示稿.slides', 'compose({ title: "Probe", slides: [createSlide()] });'],
];

export async function installFixture(session, positionals) {
  if (positionals.length !== 1 || positionals[0] !== 'project-overview' || session.options.entry) {
    throw new ProbeError('USAGE', 'fixture 仅支持真实探针实例的 project-overview');
  }
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
