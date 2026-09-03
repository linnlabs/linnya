import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useKonvaStage } from './useKonvaStage';

describe('useKonvaStage', () => {
  it('matches the Konva stage to the committed raster scale', () => {
    const slideSize = ref({ width: 10, height: 5.625, unit: 'in' as const });
    const rasterScale = ref(1.5);

    const { logicalSize, stageConfig, contentTransform } = useKonvaStage({
      slideSize,
      rasterScale,
    });

    expect(logicalSize.value.width).toBe(960);
    expect(logicalSize.value.height).toBe(540);
    expect(stageConfig.value.width).toBe(1440);
    expect(stageConfig.value.height).toBe(810);
    expect(contentTransform.value.scaleX).toBe(1.5);
    expect(contentTransform.value.scaleY).toBe(1.5);
  });

  it('reacts when the committed raster scale changes', () => {
    const slideSize = ref({ width: 10, height: 5.625, unit: 'in' as const });
    const rasterScale = ref(1);

    const { stageConfig, contentTransform } = useKonvaStage({
      slideSize,
      rasterScale,
    });

    expect(stageConfig.value.width).toBe(960);
    expect(stageConfig.value.height).toBe(540);
    expect(contentTransform.value.scaleX).toBe(1);
    expect(contentTransform.value.scaleY).toBe(1);

    rasterScale.value = 1.25;

    expect(stageConfig.value.width).toBe(1200);
    expect(stageConfig.value.height).toBe(675);
    expect(contentTransform.value.scaleX).toBe(1.25);
    expect(contentTransform.value.scaleY).toBe(1.25);
  });

  it('falls back to the default slide size when render metadata is absent', () => {
    const slideSize = ref(null);
    const rasterScale = ref(1);

    const { logicalSize, stageConfig } = useKonvaStage({
      slideSize,
      rasterScale,
    });

    expect(logicalSize.value.width).toBe(960);
    expect(logicalSize.value.height).toBe(540);
    expect(stageConfig.value.width).toBe(960);
    expect(stageConfig.value.height).toBe(540);
  });
});
