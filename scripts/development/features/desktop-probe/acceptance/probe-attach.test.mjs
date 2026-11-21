import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { parseProbeArgs } from '../functions/parseProbeArgs.mjs';
import { ATTACH_COMMANDS, assertAttachCommand } from '../orchestration/probeAttach.mjs';
import {
  developmentAttachmentFile, developmentLogDirectory, readDevelopmentAttachment, removeDevelopmentAttachment,
  reserveLoopbackPort, writeDevelopmentAttachment,
} from '../../dev-attach/functions/developmentAttachment.mjs';

test('附着信息跟随 LINNYA_DEV_INSTANCE_ROOT，与 _dev_electron / _dev_data 同处移动', () => {
  assert.equal(developmentAttachmentFile('/repo', ''), path.join('/repo', '_dev_electron', 'runtime', 'dev-attach.json'));
  assert.equal(developmentAttachmentFile('/repo', 'instances/a'), path.join('/repo', 'instances', 'a', '_dev_electron', 'runtime', 'dev-attach.json'));
  assert.equal(developmentLogDirectory('/repo', '/abs/b'), path.join('/abs', 'b', '_dev_data', 'logs'));
});

test('只删除本会话写下的附着记录，不误删同一 profile 更新的会话', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'probe-attach-'));
  try {
    const file = path.join(root, 'runtime', 'dev-attach.json');
    writeDevelopmentAttachment(file, { cdpPort: 1, viteUrl: 'http://127.0.0.1:5173', launcherPid: 10 });
    assert.equal(readDevelopmentAttachment(file).launcherPid, 10);
    removeDevelopmentAttachment(file, 11);
    assert.ok(existsSync(file));
    removeDevelopmentAttachment(file, 10);
    assert.ok(!existsSync(file));
    assert.equal(readDevelopmentAttachment(file), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('调试端口由系统分配且只在回环', async () => {
  const port = await reserveLoopbackPort();
  assert.ok(Number.isInteger(port) && port > 0);
});

test('--attach 只开放只读命令：点击等写操作在解析阶段就不认 --attach，eval --main 与非 Renderer 日志被拒', () => {
  assert.deepEqual([...ATTACH_COMMANDS].sort(), ['eval', 'fonts', 'logs', 'shot', 'snapshot', 'status', 'wait']);
  for (const command of ['click', 'type', 'press', 'drag', 'scroll', 'reload', 'open', 'stop', 'up', 'restart']) {
    assert.throws(() => parseProbeArgs([command, '--attach']), { code: 'USAGE' });
  }
  assert.equal(parseProbeArgs(['snapshot', '--attach']).values.attach, true);
  assert.throws(() => assertAttachCommand('eval', { main: true }), { code: 'USAGE' });
  assert.throws(() => assertAttachCommand('logs', { source: 'desktop' }), { code: 'USAGE' });
  assert.doesNotThrow(() => assertAttachCommand('logs', {}));
});
