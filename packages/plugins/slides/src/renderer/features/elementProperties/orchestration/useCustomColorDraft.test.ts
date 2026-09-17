import { describe, expect, it } from 'vitest';
import { useCustomColorDraft } from './useCustomColorDraft';

describe('custom color draft workflow', () => {
  it('shares exact bytes across RGB, HSV and HEX without mode-switch drift', () => {
    const draft = useCustomColorDraft();
    draft.reset('#123ABC');
    draft.setMode('rgb');
    expect(draft.rgbDraft.value).toEqual({ red: 18, green: 58, blue: 188 });
    draft.setRgbChannel('red', 201);
    for (let index = 0; index < 20; index++) { draft.setMode('hsv'); draft.setMode('rgb'); }
    expect(draft.validColor.value).toBe('#C93ABC');
    expect(draft.draftColor.value).toBe('#C93ABC');
    draft.setHex('00ff80');
    expect(draft.rgbDraft.value).toEqual({ red: 0, green: 255, blue: 128 });
    draft.setChannel('brightness', 0);
    draft.setChannel('hue', 240);
    expect(draft.validColor.value).toBe('#000000');
    draft.setChannel('brightness', 100);
    expect(draft.validColor.value).toBe('#0000FF');
  });

  it('retains invalid input for correction and prevents stale color application in either mode', () => {
    const draft = useCustomColorDraft();
    draft.reset('#123456');
    draft.setMode('rgb');
    for (const invalid of ['', -1, 256, 0.5]) {
      draft.setRgbChannel('red', invalid);
      expect(draft.rgbDraft.value.red).toBe(invalid);
      expect(draft.validColor.value).toBeNull();
      expect(draft.draftColor.value).toBe('#123456');
    }
    draft.setMode('hsv');
    expect(draft.validColor.value).toBeNull();
    draft.setHex('#ABCDEF');
    expect(draft.validColor.value).toBe('#ABCDEF');
    draft.setHex('#12');
    draft.setMode('rgb');
    expect(draft.validColor.value).toBeNull();
    draft.setRgbChannel('green', 0);
    expect(draft.validColor.value).toBe('#AB00EF');
    draft.reset('#123456');
    expect(draft.validColor.value).toBe('#123456');
  });
});
