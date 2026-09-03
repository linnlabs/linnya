import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createHiddenWorkerArtifactAdmission } from './assertHiddenWorkerDescriptorAllowed';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('createHiddenWorkerArtifactAdmission', () => {
  it('只允许同一已批准插件根内的非空 HTML 与 preload', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-worker-admission-'));
    roots.push(root);
    const pluginRoot = path.join(root, 'plugins', 'slides');
    fs.mkdirSync(pluginRoot, { recursive: true });
    const workerHtmlPath = path.join(pluginRoot, 'worker.html');
    const preloadPath = path.join(pluginRoot, 'preload.cjs');
    fs.writeFileSync(workerHtmlPath, '<!doctype html>');
    fs.writeFileSync(preloadPath, 'module.exports = {};');
    const admission = createHiddenWorkerArtifactAdmission([path.join(root, 'plugins')]);

    expect(() => admission.assertDescriptorAllowed({
      id: 'slides-raster',
      requestChannel: 'request',
      responseChannel: 'response',
      readyChannel: 'ready',
      workerHtmlPath,
      preloadPath,
    })).not.toThrow();
  });

  it('拒绝跨根拼接以及 symlink 逃逸', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-worker-admission-'));
    roots.push(root);
    const allowedRoot = path.join(root, 'allowed');
    const outsideRoot = path.join(root, 'outside');
    fs.mkdirSync(allowedRoot);
    fs.mkdirSync(outsideRoot);
    const workerHtmlPath = path.join(allowedRoot, 'worker.html');
    const outsidePreload = path.join(outsideRoot, 'preload.cjs');
    const linkedPreload = path.join(allowedRoot, 'preload.cjs');
    fs.writeFileSync(workerHtmlPath, '<!doctype html>');
    fs.writeFileSync(outsidePreload, 'module.exports = {};');
    fs.symlinkSync(outsidePreload, linkedPreload);
    const admission = createHiddenWorkerArtifactAdmission([allowedRoot]);

    expect(() => admission.assertDescriptorAllowed({
      id: 'escaped-worker',
      requestChannel: 'request',
      responseChannel: 'response',
      readyChannel: 'ready',
      workerHtmlPath,
      preloadPath: linkedPreload,
    })).toThrow('已批准插件目录');
  });
});
