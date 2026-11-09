import type { CanvasChromeColors } from '../kernel';

let probeCanvas: HTMLCanvasElement | null = null;

function readProbeContext(): CanvasRenderingContext2D {
  if (!probeCanvas) {
    probeCanvas = document.createElement('canvas');
    probeCanvas.width = 1;
    probeCanvas.height = 1;
  }
  const context = probeCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas_2d_unavailable');
  return context;
}

/** 把任意 CSS 颜色（含 color-mix）解析成不透明 RGB 整数；只在主题或偏好变化时调用。 */
function resolveColor(probe: HTMLElement, token: string): number {
  probe.style.color = `var(${token})`;
  const context = readProbeContext();
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = getComputedStyle(probe).color;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
  return (red << 16) | (green << 8) | blue;
}

/** 画布内的界面色（选中、底色、墨色）跟随 Renderer UI 主题 token，不在 Kernel 里写品牌色。 */
export function readCanvasChrome(): CanvasChromeColors {
  const probe = document.createElement('span');
  probe.hidden = true;
  document.body.append(probe);
  try {
    return {
      // 选中框只有 1.5px：用主题给“强调色落在底色上”准备的文字色，暗色主题自动换成亮绿，
      // 落在深色或染色卡上也看得清；浅色主题与主色几乎相同。
      accent: resolveColor(probe, '--color-accent-text'),
      background: resolveColor(probe, '--color-bg-sidebar'),
      ink: resolveColor(probe, '--color-text-primary'),
      label: resolveColor(probe, '--color-text-secondary'),
    };
  } finally {
    probe.remove();
  }
}
