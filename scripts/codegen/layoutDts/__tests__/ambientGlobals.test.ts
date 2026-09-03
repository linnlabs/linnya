import { describe, expect, it } from 'vitest';

import { renderAmbientGlobals, AMBIENT_GLOBALS } from '../ambientGlobals.js';

/**
 * The ambient globals snapshot is the single source of truth that drives
 * what the AI is allowed to reference inside `ppt_write.source`. It must
 * stay aligned with what `pptComposeProfile.ts` actually injects in
 * `codegen-source` mode (see `prepareExecution`).
 *
 * Specifically:
 *   - `SLIDE_W`, `SLIDE_H`, `CHART_PRESETS`, `DECK_DESIGN` come from
 *     `runnerRequest.globals`.
 *   - `compose` comes from a capability binding (`host.compose`).
 *   - `editPresentation` is **not** declared, because in `codegen-source`
 *     mode it is stubbed to throw — declaring it would let the AI write
 *     code that compiles cleanly but is rejected at runtime.
 */
describe('ambientGlobals', () => {
  it('declares the four sandbox-injected globals', () => {
    const names = AMBIENT_GLOBALS.map((g) => g.name).sort();
    expect(names).toContain('SLIDE_W');
    expect(names).toContain('SLIDE_H');
    expect(names).toContain('CHART_PRESETS');
    expect(names).toContain('DECK_DESIGN');
  });

  it('declares `compose` as a function (the only capability allowed in codegen-source mode)', () => {
    const names = AMBIENT_GLOBALS.map((g) => g.name);
    expect(names).toContain('compose');
  });

  it('declares the sandbox-provided console logging methods', () => {
    const consoleEntry = AMBIENT_GLOBALS.find((g) => g.name === 'console');
    expect(consoleEntry?.text).toContain('log(...args: unknown[]): void');
    expect(consoleEntry?.text).toContain('warn(...args: unknown[]): void');
    expect(consoleEntry?.text).toContain('error(...args: unknown[]): void');
  });

  it('does NOT declare `editPresentation` (intentionally — stub-throws in codegen-source mode)', () => {
    const names = AMBIENT_GLOBALS.map((g) => g.name);
    expect(names).not.toContain('editPresentation');
  });

  it('SLIDE_W / SLIDE_H are typed as `number`', () => {
    const slideW = AMBIENT_GLOBALS.find((g) => g.name === 'SLIDE_W');
    const slideH = AMBIENT_GLOBALS.find((g) => g.name === 'SLIDE_H');
    expect(slideW?.text).toMatch(/const SLIDE_W:\s*number/);
    expect(slideH?.text).toMatch(/const SLIDE_H:\s*number/);
  });

  it('CHART_PRESETS is the exact readonly preset-name array', () => {
    const presets = AMBIENT_GLOBALS.find((g) => g.name === 'CHART_PRESETS');
    expect(presets?.text).toMatch(/const CHART_PRESETS:\s*readonly\s+LayoutChartPresetName\[\]/);
  });

  it('DECK_DESIGN exposes palette and fonts sub-objects', () => {
    const dd = AMBIENT_GLOBALS.find((g) => g.name === 'DECK_DESIGN');
    expect(dd?.text).toContain('palette');
    expect(dd?.text).toContain('fonts');
  });

  it('`compose` accepts FlexComposeInput and returns void', () => {
    const compose = AMBIENT_GLOBALS.find((g) => g.name === 'compose');
    expect(compose?.text).toMatch(/function compose\(/);
    expect(compose?.text).toMatch(/FlexComposeInput/);
    expect(compose?.text).toMatch(/:\s*void/);
  });

  it('renderAmbientGlobals returns symbols sorted alphabetically by name (deterministic)', () => {
    const symbols = renderAmbientGlobals();
    const names = symbols.map((s) => s.name);
    expect(names).toEqual([...names].sort());
  });

  it('every rendered symbol carries a JSDoc comment', () => {
    for (const sym of renderAmbientGlobals()) {
      expect(sym.text, sym.name).toContain('/**');
    }
  });
});
