import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import {
  describeLinnyaCommandElsewhere,
  formatLinnyaCommandOverview,
  LINNYA_COMMANDS,
} from '@app/schemas/linnya-commands';
import { createNodePhysicalFileReader } from '../../../adapters/file-read';
import { createVisionForegroundMask } from '../../../adapters/foreground-mask';
import { createCoreCli } from '../orchestration/createCoreCli';

/** 命令目录与 Shell 里实际分发的命令要一致：目录写了却没实现，或实现了却没登记，帮助就会骗人。 */
const db = new Database(':memory:');
const activity = {
  runs: { readCandidates: async () => { throw new Error('unused'); } },
  approvals: { readControlPending: () => { throw new Error('unused'); } },
};
const cli = createCoreCli(db, 4000, createNodePhysicalFileReader(), createVisionForegroundMask(), activity);
afterAll(() => db.close());

function prepare(argv: readonly string[]) {
  return cli.prepare({ argv, invocationId: 'test', conversationRoot: '/tmp/none' });
}

describe('linnya 命令目录（对话 Shell 一侧）', () => {
  const overview = formatLinnyaCommandOverview('agent_shell');

  it('--help 带上与外部终端共用的总览', () => {
    const help = prepare(['--help']);
    expect(help.status === 'completed' && help.result.stdout).toContain(overview);
  });

  it('外部终端的命令在 Shell 里给出去处，不倒出整份用法', () => {
    for (const command of LINNYA_COMMANDS.filter(entry => entry.environment === 'terminal')) {
      const preparation = prepare([command.name, 'anything']);
      expect(preparation, command.name).toMatchObject({
        status: 'completed',
        result: { exitCode: 2, stdout: '', stderr: describeLinnyaCommandElsewhere(command) + '\n' },
      });
    }
  });

  it('目录里的 Shell 命令都有实现，目录外的名字才落到整份帮助', () => {
    for (const command of LINNYA_COMMANDS.filter(entry => entry.environment === 'agent_shell')) {
      const preparation = prepare([command.name, '--definitely-not-an-option']);
      const fellThrough = preparation.status === 'completed' && preparation.result.stderr.includes(overview);
      expect(fellThrough, command.name).toBe(false);
    }
    const unknown = prepare(['no-such-command']);
    expect(unknown.status === 'completed' && unknown.result.stderr).toContain(overview);
  });
});
