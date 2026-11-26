import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { preparePluginArtifactForSmoke } from './preparePluginArtifactForSmoke.mjs';

let temporary, repoRoot, packageDir, manifest;
beforeEach(() => {
  temporary = mkdtempSync(path.join(os.tmpdir(), 'plugin-smoke-'));
  repoRoot = path.join(temporary, 'checkout');
  packageDir = path.join(repoRoot, 'packages/plugins/example');
  manifest = path.join(packageDir, 'dist/artifacts/latest.json');
  mkdirSync(path.dirname(manifest), { recursive: true });
  vi.stubEnv('LINNYA_CI_ARTIFACT_CHECKOUT', repoRoot);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(temporary, { recursive: true, force: true });
});

it('shares a completed package, rejects replacement and builds afresh for standalone smoke', () => {
  const build = vi.fn(() => writeFileSync(manifest, JSON.stringify({ sha512: 'original' })));
  const prepare = () => preparePluginArtifactForSmoke({ packageDir, repoRoot, build });
  prepare();
  prepare();
  expect(build).toHaveBeenCalledTimes(1);
  writeFileSync(manifest, JSON.stringify({ sha512: 'replacement' }));
  expect(prepare).toThrow('artifact changed');
  vi.stubEnv('LINNYA_CI_ARTIFACT_CHECKOUT', '');
  prepare();
  expect(build).toHaveBeenCalledTimes(2);
});

it('propagates the failed artifact guard even if the packager has already written its outputs', () => {
  const build = vi.fn(() => {
    writeFileSync(manifest, JSON.stringify({ sha512: 'incomplete' }));
    throw new Error('artifact guard failed');
  });
  const prepare = () => preparePluginArtifactForSmoke({ packageDir, repoRoot, build });
  expect(prepare).toThrow('artifact guard failed');
  expect(prepare).toThrow('did not finish successfully');
  expect(build).toHaveBeenCalledTimes(1);
});
