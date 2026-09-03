import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import ts from 'typescript';

import { buildLayoutDts } from '../codegen/generate-layout-dts.js';
import { runCheck } from '../codegen/check-layout-dts.js';
import {
  LAYOUT_TYPES_SOURCES,
  LAYOUT_DTS_OUTPUT_PATHS_RELATIVE,
  REPO_ROOT,
  resolveOutputPaths,
} from '../codegen/layoutDts/outputs.js';

/**
 * End-to-end coverage for the `generate-layout-dts` toolchain.
 *
 * - The pure builder (`buildLayoutDts`) is exercised against the **real**
 *   `flexComposeContract.ts` source, asserting structural invariants of the
 *   produced d.ts.
 * - The output is then fed back through the TypeScript compiler API to
 *   verify it is at minimum syntactically valid (no parse diagnostics).
 * - The drift-checker (`runCheck`) is exercised in two states: in-sync
 *   (must report ok), and tampered-on-disk (must report a mismatch).
 *
 * The tampering test snapshots the file beforehand and restores it in
 * `afterEach` so the suite is hermetic and safe to run in any order.
 */

const ABS_OUTPUTS = resolveOutputPaths();

interface SourceFileWithParseDiagnostics extends ts.SourceFile {
  parseDiagnostics?: readonly ts.Diagnostic[];
}

describe('generate-layout-dts (integration)', () => {
  describe('buildLayoutDts', () => {
    it('reads the real LayoutTypes.ts source files', () => {
      for (const src of LAYOUT_TYPES_SOURCES) {
        expect(fs.existsSync(src), src).toBe(true);
      }
    });

    it('returns the same canonical output paths declared in outputs.ts', () => {
      const { outputPaths } = buildLayoutDts();
      expect(outputPaths).toEqual(ABS_OUTPUTS);
      expect(outputPaths.length).toBe(LAYOUT_DTS_OUTPUT_PATHS_RELATIVE.length);
    });

    it('produces a non-empty d.ts containing all the expected top-level constructs', () => {
      const { content } = buildLayoutDts();
      expect(content.length).toBeGreaterThan(1000);
      expect(content).toContain('declare global');
      expect(content).toContain('export {};');

      // Every factory must be present inside the declare-global block.
      for (const factoryName of [
        'createSlide',
        'createFrame',
        'createText',
        'createShape',
        'createChart',
        'createTable',
        'createImage',
        'createSpacer',
      ]) {
        expect(content, factoryName).toMatch(new RegExp(`function ${factoryName}\\s*\\(`));
      }

      // Every sandbox global must be present.
      expect(content).toMatch(/const SLIDE_W:\s*number/);
      expect(content).toMatch(/const SLIDE_H:\s*number/);
      expect(content).toMatch(/const CHART_PRESETS:\s*readonly\s+LayoutChartPresetName\[\]/);
      expect(content).toMatch(/const DECK_DESIGN:/);
      expect(content).toMatch(/function compose\(/);

      // editPresentation MUST NOT appear: codegen-source mode rejects it.
      expect(content).not.toMatch(/function\s+editPresentation\b/);

      // Module-scope type-guard functions must be filtered out — they
      // exist in flexComposeContract.ts but the sandbox does not inject them.
      expect(content).not.toMatch(/declare function\s+isContainerNode\b/);
      expect(content).not.toMatch(/declare function\s+isFlexComposeInput\b/);
    });

    it('extracts FlexComposeInput / LayoutSlideNode / LayoutNode and friends as module-scope interfaces', () => {
      const { content } = buildLayoutDts();
      expect(content).toMatch(/interface FlexComposeInput\b/);
      expect(content).toMatch(/interface FlexProps\b/);
      expect(content).toMatch(/interface LayoutSlideNode\b/);
      expect(content).toMatch(/interface LayoutViewNode\b/);
      expect(content).toMatch(/type LayoutNode\b/);
    });

    it('emits exact self-contained authoring types without unknown capability stubs', () => {
      const { content } = buildLayoutDts();
      expect(content).not.toMatch(/type\s+\w+\s*=\s*unknown;/);
      expect(content).toMatch(/type LayoutTextRun\b/);
      expect(content).toMatch(/interface LayoutChartSeriesInput\b/);
      expect(content).toMatch(/interface LayoutTableCellInput\b/);
      expect(content).toMatch(/interface LayoutImageVisualShadowInput\b/);
      expect(content).toMatch(/interface LayoutThemeInput\b/);
    });

    it('keeps internal and raw renderer fields out of public factory configs', () => {
      const { content } = buildLayoutDts();
      expect(content).not.toMatch(/\bchartOptions\??:/);
      expect(content).not.toMatch(/\btableOptions\??:/);
      expect(content).not.toMatch(/\bstyleDecision\??:/);
      expect(content).toContain('function createChart(config: LayoutChartConfig)');
      expect(content).toContain('function createSlide(config?: LayoutSlideConfig)');
    });

    it('does NOT emit a stub for value-only imports whose call sites were dropped (e.g. isRecord)', () => {
      const { content } = buildLayoutDts();
      expect(content).not.toMatch(/type isRecord\s*=\s*unknown;/);
    });

    it('uses LF newlines and ends with exactly one trailing newline', () => {
      const { content } = buildLayoutDts();
      expect(content).not.toMatch(/\r\n/);
      expect(content.endsWith('\n')).toBe(true);
      expect(content.endsWith('\n\n')).toBe(false);
    });

    it('is byte-deterministic across consecutive invocations', () => {
      const a = buildLayoutDts().content;
      const b = buildLayoutDts().content;
      expect(a).toBe(b);
    });

    it('is syntactically valid TypeScript (no parser diagnostics)', () => {
      const { content } = buildLayoutDts();
      const sf = ts.createSourceFile(
        'pptComposeProfile.ambient.d.ts',
        content,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ false,
        ts.ScriptKind.TS
      );
      // Parse diagnostics live on the SourceFile itself.
      const diags = (sf as SourceFileWithParseDiagnostics).parseDiagnostics ?? [];
      const messages = diags.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      expect(messages, messages.join('\n---\n')).toEqual([]);
    });

    it('is semantically valid TypeScript for sandbox typecheck consumption', () => {
      const { content } = buildLayoutDts();
      const fileName = path.join(REPO_ROOT, 'pptComposeProfile.ambient.d.ts');
      const options: ts.CompilerOptions = {
        noEmit: true,
        strict: true,
        skipLibCheck: false,
        types: [],
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['lib.es2022.d.ts'],
      };
      const host = ts.createCompilerHost(options);
      const originalGetSourceFile = host.getSourceFile.bind(host);
      host.getSourceFile = (
        requestedFileName,
        languageVersion,
        onError,
        shouldCreateNewSourceFile
      ) => {
        if (requestedFileName === fileName) {
          return ts.createSourceFile(fileName, content, languageVersion, true, ts.ScriptKind.TS);
        }
        return originalGetSourceFile(
          requestedFileName,
          languageVersion,
          onError,
          shouldCreateNewSourceFile
        );
      };

      const program = ts.createProgram([fileName], options, host);
      const diags = ts.getPreEmitDiagnostics(program).filter(d => d.file?.fileName === fileName);
      const messages = diags.map(d => {
        const pos =
          d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
        const location = pos ? `${pos.line + 1}:${pos.character + 1}` : 'unknown';
        return `${location} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
      });
      expect(messages, messages.join('\n---\n')).toEqual([]);
    });
  });

  describe('runCheck', () => {
    afterEach(() => {
      // Ensure on-disk file matches generator output again, even when a
      // test threw mid-tamper. We re-write only when content differs to
      // avoid touching mtime unnecessarily.
      const { content, outputPaths } = buildLayoutDts();
      for (const p of outputPaths) {
        if (!fs.existsSync(p) || fs.readFileSync(p, 'utf-8') !== content) {
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, content, 'utf-8');
        }
      }
    });

    it('reports ok=true when on-disk file matches generator output', () => {
      // Sanity-write first so the test doesn't depend on prior CI state.
      const { content, outputPaths } = buildLayoutDts();
      for (const p of outputPaths) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content, 'utf-8');
      }

      const result = runCheck();
      expect(result.ok).toBe(true);
      expect(result.diffs).toEqual([]);
    });

    it('reports ok=false with `mismatch` when on-disk file is stale', () => {
      const { content, outputPaths } = buildLayoutDts();
      const target = outputPaths[0];

      // Mutate the on-disk content (insert a marker line so we can pin
      // the diff position deterministically).
      const tampered = `// drift-injected marker — should never land in source control\n${content}`;
      fs.writeFileSync(target, tampered, 'utf-8');

      const result = runCheck();
      expect(result.ok).toBe(false);
      expect(result.diffs.length).toBeGreaterThan(0);
      expect(result.diffs[0].path).toBe(target);
      expect(result.diffs[0].reason).toBe('mismatch');
      expect(result.diffs[0].firstDiffLine).toBe(0);
      expect(result.diffs[0].preview ?? '').toContain('drift-injected marker');
    });

    it('reports ok=false with `missing` when on-disk file is absent', async () => {
      const target = resolveOutputPaths()[0];

      // Move the file aside instead of deleting, so afterEach can restore.
      const tmp = path.join(os.tmpdir(), `layoutDts-${Date.now()}.bak`);
      fs.renameSync(target, tmp);
      try {
        const result = runCheck();
        expect(result.ok).toBe(false);
        expect(result.diffs.length).toBeGreaterThan(0);
        expect(result.diffs[0].reason).toBe('missing');
      } finally {
        if (fs.existsSync(tmp) && !fs.existsSync(target)) {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.renameSync(tmp, target);
        }
      }
    });

    it('outputs paths under the repo root (no absolute paths leaking out as relative)', () => {
      for (const p of resolveOutputPaths()) {
        expect(path.isAbsolute(p)).toBe(true);
        expect(p.startsWith(REPO_ROOT)).toBe(true);
      }
    });
  });
});
