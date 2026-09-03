import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureHarfBuzzModule,
  getReadyHarfBuzzModule,
  isHarfBuzzReady,
  resetHarfBuzzModuleForTests,
} from '../harfbuzzModule.js';

describe('harfbuzzModule', () => {
  afterEach(() => {
    resetHarfBuzzModuleForTests();
  });

  it('同步读取前必须先完成异步初始化', () => {
    expect(isHarfBuzzReady()).toBe(false);
    expect(() => getReadyHarfBuzzModule()).toThrow(/not ready/i);
  });

  it('只初始化一次并暴露已就绪模块', async () => {
    const firstPromise = ensureHarfBuzzModule();
    const secondPromise = ensureHarfBuzzModule();

    expect(isHarfBuzzReady()).toBe(false);
    expect(secondPromise).toBe(firstPromise);

    const firstModule = await firstPromise;
    const secondModule = getReadyHarfBuzzModule();

    expect(isHarfBuzzReady()).toBe(true);
    expect(secondModule).toBe(firstModule);
    expect(typeof firstModule.shape).toBe('function');
    expect(typeof firstModule.Face).toBe('function');
  });
});
