import { describe, expect, it } from 'vitest';
import { colorPlaneValue, colorToHsv, hsvToColor, normalizeCustomColor } from './customColor';

describe('custom color editing', () => {
  it('round-trips supported HEX colors including grayscale and hue boundaries', () => {
    for (const hex of ['#000000', '#FFFFFF', '#808080', '#FF0000', '#00FF00', '#0000FF', '#FF00FF', '#123ABC']) {
      expect(hsvToColor(colorToHsv(hex))).toBe(hex);
    }
    expect(hsvToColor({ hue: 120, saturation: 1, brightness: 1 })).toBe('#00FF00');
    expect(normalizeCustomColor(' 123abc ')).toBe('#123ABC');
    expect(normalizeCustomColor('#12')).toBeNull();
    expect(normalizeCustomColor('#12345678')).toBeNull();
  });
  it('keeps the captured plane drag inside its color range outside the visible plane', () => {
    expect(colorPlaneValue(-20, 140, 200, 100)).toEqual({ saturation: 0, brightness: 0 });
    expect(colorPlaneValue(220, -40, 200, 100)).toEqual({ saturation: 1, brightness: 1 });
    expect(colorPlaneValue(100, 25, 200, 100)).toEqual({ saturation: 0.5, brightness: 0.75 });
  });
});
