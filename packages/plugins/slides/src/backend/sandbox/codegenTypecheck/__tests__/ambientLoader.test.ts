import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  __clearAmbientCacheForTests,
  loadAmbient,
  resolveAmbientPathForRuntime,
} from '../ambientLoader.js';

const slidesPackageDirectory = path.resolve(import.meta.dirname, '../../../../..');
const repositoryRoot = path.resolve(slidesPackageDirectory, '../../..');

describe('ambientLoader', () => {
  beforeEach(() => __clearAmbientCacheForTests());
  afterEach(() => __clearAmbientCacheForTests());

  it('loads the canonical ambient.d.ts from disk and parses it as a TS SourceFile', () => {
    const handle = loadAmbient();
    expect(handle.text).toContain('declare global');
    expect(handle.text).toContain('function createSlide');
    expect(handle.sourceFile.fileName).toBe(handle.virtualFileName);
    expect(handle.sourceFile.statements.length).toBeGreaterThan(0);
  });

  it('resolves the canonical ambient path when moduleUrl is unavailable in CJS runtime', () => {
    const ambientPath = resolveAmbientPathForRuntime({
      moduleUrl: undefined,
      cwd: repositoryRoot,
      fileExists: fs.existsSync,
    });

    expect(ambientPath).toBe(
      path.join(
        repositoryRoot,
        'packages',
        'plugins',
        'slides',
        'src',
        'backend',
        'sandbox',
        'pptComposeProfile.ambient.d.ts',
      ),
    );
  });

  it('does not fall back to the deleted host ambient mirror in artifact-style layouts', () => {
    const cwd = repositoryRoot;
    const pluginSourcePath = path.join(
      cwd,
      'packages',
      'plugins',
      'slides',
      'src',
      'backend',
      'sandbox',
      'pptComposeProfile.ambient.d.ts',
    );
    const pluginDistPath = path.join(
      cwd,
      'packages',
      'plugins',
      'slides',
      'dist',
      'backend',
      'sandbox',
      'pptComposeProfile.ambient.d.ts',
    );
    const deletedHostMirrorPath = path.join(
      cwd,
      'src',
      'features',
      'sandbox',
      'profiles',
      'pptComposeProfile.ambient.d.ts',
    );

    const ambientPath = resolveAmbientPathForRuntime({
      moduleUrl: undefined,
      cwd,
      fileExists: (candidate) => candidate === pluginDistPath || candidate === deletedHostMirrorPath,
    });

    expect(ambientPath).toBe(pluginDistPath);
    expect(ambientPath).not.toBe(pluginSourcePath);
    expect(ambientPath).not.toBe(deletedHostMirrorPath);
  });

  it('fails when only the deleted host ambient mirror is visible', () => {
    const cwd = repositoryRoot;
    const deletedHostMirrorPath = path.join(
      cwd,
      'src',
      'features',
      'sandbox',
      'profiles',
      'pptComposeProfile.ambient.d.ts',
    );

    expect(() => resolveAmbientPathForRuntime({
      moduleUrl: undefined,
      cwd,
      fileExists: (candidate) => candidate === deletedHostMirrorPath,
    })).toThrow('Unable to locate pptComposeProfile.ambient.d.ts.');
  });

  it('returns the SAME SourceFile reference on subsequent calls (in-process cache)', () => {
    const a = loadAmbient();
    const b = loadAmbient();
    expect(a.sourceFile).toBe(b.sourceFile);
    expect(a.text).toBe(b.text);
  });

  it('bypassCache:true reparses from disk (different SourceFile reference, same text)', () => {
    const a = loadAmbient();
    const b = loadAmbient({ bypassCache: true });
    expect(a.text).toBe(b.text);
    expect(a.sourceFile).not.toBe(b.sourceFile);
  });

  it('honours a custom ambientPath (used by integration tests)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-loader-'));
    const tmpFile = path.join(tmpDir, 'test.d.ts');
    fs.writeFileSync(tmpFile, 'declare const X: number;\n', 'utf-8');
    try {
      const handle = loadAmbient({ ambientPath: tmpFile });
      expect(handle.text).toContain('declare const X');
      expect(handle.sourceFile.statements.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('caches separately per (ambientPath, virtualFileName) pair', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-loader-'));
    const tmpFile = path.join(tmpDir, 'a.d.ts');
    fs.writeFileSync(tmpFile, 'declare const X: number;\n', 'utf-8');
    try {
      const a = loadAmbient({ ambientPath: tmpFile, virtualFileName: '/virt/one.d.ts' });
      const b = loadAmbient({ ambientPath: tmpFile, virtualFileName: '/virt/two.d.ts' });
      const a2 = loadAmbient({ ambientPath: tmpFile, virtualFileName: '/virt/one.d.ts' });
      expect(a.sourceFile).not.toBe(b.sourceFile);
      expect(a2.sourceFile).not.toBe(a.sourceFile); // last-write-wins single-slot cache
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('virtualFileName is reflected on the SourceFile.fileName so the program sees it consistently', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-loader-'));
    const tmpFile = path.join(tmpDir, 'a.d.ts');
    fs.writeFileSync(tmpFile, 'declare const X: number;\n', 'utf-8');
    try {
      const handle = loadAmbient({
        ambientPath: tmpFile,
        virtualFileName: '/custom/v.d.ts',
      });
      expect(handle.sourceFile.fileName).toBe('/custom/v.d.ts');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
