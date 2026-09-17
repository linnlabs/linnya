import { computed, ref } from 'vue';
import type { CustomColorHsv, CustomColorMode, CustomColorRgbChannel, CustomColorRgbDraft } from '../definitions/customColor';
import { colorToHsv, colorToRgb, hsvToColor, normalizeCustomColor, rgbDraftToColor } from '../functions/customColor';

/** HSV、RGB、HEX 是同一草稿的不同入口；切换模式不转换或提交，避免累积舍入误差。 */
export function useCustomColorDraft() {
  const mode = ref<CustomColorMode>('hsv');
  const hexDraft = ref('#000000');
  const hsv = ref<CustomColorHsv>(colorToHsv('#000000'));
  const rgbDraft = ref<CustomColorRgbDraft>(colorToRgb('#000000'));
  const draftColor = computed(() => hsvToColor(hsv.value));
  const rgb = computed(() => colorToRgb(draftColor.value));
  const validHex = computed(() => normalizeCustomColor(hexDraft.value));
  const validRgb = computed(() => rgbDraftToColor(rgbDraft.value));
  const validColor = computed(() => validRgb.value ? validHex.value : null);

  function reset(color: string): void {
    hexDraft.value = color;
    hsv.value = colorToHsv(color);
    rgbDraft.value = colorToRgb(color);
  }
  function setMode(value: string): void {
    if (value === 'hsv' || value === 'rgb') mode.value = value;
  }
  function setHex(value: string): void {
    hexDraft.value = value;
    const normalized = normalizeCustomColor(value);
    if (!normalized) return;
    hsv.value = colorToHsv(normalized);
    rgbDraft.value = colorToRgb(normalized);
  }
  function setHsv(value: CustomColorHsv): void {
    // 保留灰色时的色相/饱和度坐标，不能用 HEX 反算抹掉连续拖动的意图。
    hsv.value = value;
    hexDraft.value = hsvToColor(value);
    rgbDraft.value = colorToRgb(hexDraft.value);
  }
  function setChannel(channel: keyof CustomColorHsv, value: number): void {
    setHsv({ ...hsv.value, [channel]: value / (channel === 'hue' ? 1 : 100) });
  }
  function setRgbChannel(channel: CustomColorRgbChannel, value: string | number): void {
    rgbDraft.value = { ...rgbDraft.value, [channel]: value };
    const color = rgbDraftToColor(rgbDraft.value);
    if (!color) return;
    hexDraft.value = color;
    hsv.value = colorToHsv(color);
  }
  return { mode, hexDraft, hsv, rgbDraft, rgb, draftColor, validHex, validRgb, validColor, reset, setMode, setHex, setHsv, setChannel, setRgbChannel };
}
