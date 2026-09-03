import { describe, expect, it } from 'vitest';

import { LAYOUT_PRIMITIVES_SOURCE } from '../../../../packages/plugins/slides/src/backend/sandbox/layoutPrimitives.js';
import {
  FACTORY_SIGNATURES,
  renderFactorySignatures,
} from '../factorySignatures.js';

/**
 * factorySignatures owns the d.ts-side of the sandbox factory contract.
 * The Source-of-Truth for the *runtime* behaviour is LAYOUT_PRIMITIVES_SOURCE.
 * These tests guarantee the two never drift:
 *   1. every `function NAME(...)` declared inside LAYOUT_PRIMITIVES_SOURCE has
 *      a matching entry in FACTORY_SIGNATURES (and vice versa for non-private
 *      helpers);
 *   2. private helpers (prefixed `_`) are explicitly excluded.
 */

function extractRuntimeFactoryNames(source: string): string[] {
  const names = new Set<string>();
  const regex = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const name = match[1];
    if (name.startsWith('_')) continue; // private helpers like _addMethod
    names.add(name);
  }
  return [...names].sort();
}

describe('factorySignatures', () => {
  it('declares exactly the same public factory names as LAYOUT_PRIMITIVES_SOURCE', () => {
    const runtimeNames = extractRuntimeFactoryNames(LAYOUT_PRIMITIVES_SOURCE);
    const dtsNames = FACTORY_SIGNATURES.map((s) => s.name).sort();
    expect(dtsNames).toEqual(runtimeNames);
  });

  it('every signature has a non-empty d.ts text', () => {
    for (const sig of FACTORY_SIGNATURES) {
      expect(sig.text.trim().length, sig.name).toBeGreaterThan(0);
      expect(sig.text, sig.name).toMatch(
        new RegExp(`function ${sig.name}\\s*\\(`),
      );
    }
  });

  it('renderFactorySignatures returns symbols sorted alphabetically (deterministic)', () => {
    const symbols = renderFactorySignatures();
    const names = symbols.map((s) => s.name);
    expect(names).toEqual([...names].sort());
  });

  it('every rendered symbol is kind=function and has a JSDoc comment', () => {
    const symbols = renderFactorySignatures();
    for (const sym of symbols) {
      expect(sym.kind, sym.name).toBe('function');
      expect(sym.text, sym.name).toContain('/**');
      expect(sym.text, sym.name).toContain('*/');
    }
  });

  it('container factories (createSlide / createFrame) return nodes with `add()` method', () => {
    const slide = FACTORY_SIGNATURES.find((s) => s.name === 'createSlide');
    const frame = FACTORY_SIGNATURES.find((s) => s.name === 'createFrame');
    expect(slide?.text).toMatch(/LayoutSlideNode\b/);
    expect(slide?.text).toMatch(/add\(/);
    expect(frame?.text).toMatch(/LayoutViewNode\b/);
    expect(frame?.text).toMatch(/add\(/);
  });

  it('leaf factories (createText etc.) do NOT expose an add() method', () => {
    const leafNames = [
      'createText',
      'createShape',
      'createChart',
      'createTable',
      'createImage',
      'createSvgGraphic',
      'createFormula',
      'createSpacer',
    ];
    for (const name of leafNames) {
      const sig = FACTORY_SIGNATURES.find((s) => s.name === name);
      expect(sig, name).toBeDefined();
      // The `add(` substring must not appear in a leaf factory signature.
      expect(sig!.text.toLowerCase(), name).not.toMatch(/add\s*\(/);
    }
  });

  it('createText accepts string / LayoutTextRun[] / exact config-object overloads', () => {
    const sig = FACTORY_SIGNATURES.find((s) => s.name === 'createText');
    expect(sig?.text).toMatch(/string/);
    expect(sig?.text).toMatch(/LayoutTextRun/);
    expect(sig?.text).toMatch(/LayoutTextConfig/);
    expect(sig?.text).toMatch(/number/);
    expect(sig?.text).toMatch(/boolean/);
  });

  it('createImage accepts formal image sources or config object (matches runtime)', () => {
    const sig = FACTORY_SIGNATURES.find((s) => s.name === 'createImage');
    expect(sig?.text).toMatch(/LayoutImageSourceInput/);
    expect(sig?.text).toMatch(/LayoutImageNode/);
  });

  it('createChart accepts string preset or config object (matches runtime)', () => {
    const sig = FACTORY_SIGNATURES.find((s) => s.name === 'createChart');
    expect(sig?.text).toMatch(/LayoutChartPresetName/);
    expect(sig?.text).toMatch(/LayoutChartConfig/);
    expect(sig?.text).toMatch(/LayoutChartNode/);
  });
});
