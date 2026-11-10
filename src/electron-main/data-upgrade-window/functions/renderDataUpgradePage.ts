import type { DataUpgradeWindowCopy } from '../definitions/dataUpgradeWindow';

/**
 * 与 renderer-ui `LinnyaLoadingIcon` 的“思考”状态同一几何（品牌标记绕中心放大 1.14×）：
 * 茎、左叶、右叶分开，整株绕茎底摆动，叶片绕交汇点慢半拍。
 */
const LINNYA_MARK_PARTS = Object.freeze({
  stem: 'M10.63 23.58C10.27 21.47 10.81 19.28 11.29 17.23C11.59 15.97 12.19 14.74 13.17 13.85C13.49 15.14 13.12 16.5 12.58 17.68C11.73 19.58 11.01 21.52 10.63 23.58Z',
  leafLeft: 'M12.11 13.41C8.48 13.65 5.71 11.84 3.97 8.11C8.24 7.95 11.01 9.75 12.11 13.41Z',
  leafRight: 'M12.91 12.66C11.51 8.63 13.69 4.9 20.03 0.42C19.65 8.06 17.82 11.99 13.97 13.31C14.45 11.13 15.45 8.37 16.98 5.63C15.19 8.05 13.82 10.56 12.91 12.66Z',
});

const LINNYA_MARK_COLOR = '#49A55C';

/** 流光亮度沿余弦曲线分段过渡；直线渐变在折角处会出现一道假亮边。 */
const SHEEN_PROFILE = [0, 0.15, 0.5, 0.85, 1, 0.85, 0.5, 0.15, 0] as const;
const SHEEN_GRADIENT = `linear-gradient(90deg, ${SHEEN_PROFILE
  .map((weight, index) => `rgb(255 255 255 / calc(var(--sheen) * ${weight})) ${index * 12.5}%`)
  .join(', ')})`;

/** 窗口底色，与页面 `--bg` 一致；BrowserWindow 用它避免加载前闪白或闪黑。 */
export const DATA_UPGRADE_WINDOW_BACKGROUND = Object.freeze({
  light: '#ffffff',
  dark: '#171717',
});

const COPIES: Readonly<Record<'zh' | 'en', DataUpgradeWindowCopy>> = Object.freeze({
  zh: Object.freeze({
    language: 'zh-CN',
    title: '正在升级数据',
    detail: '数据较多时可能需要几分钟，请不要关闭 Linnya',
  }),
  en: Object.freeze({
    language: 'en',
    title: 'Upgrading your data',
    detail: 'This may take a few minutes. Please keep Linnya open.',
  }),
});

/** 主进程还没有 Renderer 的语言设置，按系统语言选择：中文系统用中文，其余用英文。 */
export function selectDataUpgradeCopy(locale: string): DataUpgradeWindowCopy {
  return locale.toLowerCase().startsWith('zh') ? COPIES.zh : COPIES.en;
}

/** 注入样式与页面自带的 `:root` 规则同源同序时会被页面覆盖，所以用更高的选择器优先级。 */
export function formatDataUpgradeProgressStyle(fraction: number): string {
  return `html:root{--progress:${clampFraction(fraction)}}`;
}

/**
 * 无脚本页面：进度只通过 `--progress` 自定义属性变化，由宿主 insertCSS 更新。
 * 颜色取 Renderer 设计 token 的实际值（背景、主文本、三级文本、强调色），随系统深浅色切换；
 * 轨道用同色系浅绿（浅色 brand-125，深色为 brand-500 混入背景 20%），不用中性灰。
 */
export function renderDataUpgradePage(input: {
  readonly copy: DataUpgradeWindowCopy;
  readonly fraction: number;
}): string {
  const { copy } = input;
  return `<!doctype html>
<html lang="${escapeHtml(copy.language)}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Linnya</title>
<style>
:root {
  color-scheme: light dark;
  --progress: ${clampFraction(input.fraction)};
  --bg: ${DATA_UPGRADE_WINDOW_BACKGROUND.light};
  --text: #171717;
  --muted: #636363;
  --track: #e1f3e6;
  --fill: #347b45;
  --sheen: 0.3;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: ${DATA_UPGRADE_WINDOW_BACKGROUND.dark};
    --text: #ededed;
    --muted: #a3a3a3;
    --track: color-mix(in srgb, #49a55c 20%, ${DATA_UPGRADE_WINDOW_BACKGROUND.dark});
    --fill: #49a55c;
    --sheen: 0.24;
  }
}
html, body { margin: 0; height: 100%; }
body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
  -webkit-app-region: drag;
}
.mark { width: 50px; height: 50px; margin-bottom: 23px; overflow: visible; }
.mark path { fill: ${LINNYA_MARK_COLOR}; }
.plant { transform-origin: 10.63px 23.58px; animation: sway 3200ms ease-in-out infinite; }
.leaf-left { transform-origin: 12.11px 13.41px; animation: sway-left 3200ms ease-in-out -2800ms infinite; }
.leaf-right { transform-origin: 13.03px 13.18px; animation: sway-right 3200ms ease-in-out -2880ms infinite; }
@keyframes sway { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(3deg); } }
@keyframes sway-left { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(3deg); } }
@keyframes sway-right { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(5deg); } }
h1 { margin: 0; font-size: 15px; font-weight: 500; line-height: 22px; }
p { margin: 6px 0 0; padding: 0 24px; font-size: 12px; line-height: 18px; color: var(--muted); text-align: center; }
.track {
  position: relative;
  width: 200px;
  height: 4px;
  margin-top: 24px;
  border-radius: 2px;
  background: var(--track);
  overflow: hidden;
}
.fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: calc(var(--progress) * 100%);
  border-radius: inherit;
  background-color: var(--fill);
  /* 流光只在已完成段里走，宽度随已完成段伸缩，不扫过未完成的轨道 */
  background-image: ${SHEEN_GRADIENT};
  background-size: 45% 100%;
  background-repeat: no-repeat;
  animation: sheen 1600ms ease-in-out infinite;
  transition: width 400ms ease;
}
@keyframes sheen {
  from { background-position: -90% 0; }
  to { background-position: 190% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .plant, .leaf-left, .leaf-right, .fill { animation: none; }
  .fill { transition: none; }
}
</style>
</head>
<body>
<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><g class="plant"><path d="${LINNYA_MARK_PARTS.stem}"/><path class="leaf-left" d="${LINNYA_MARK_PARTS.leafLeft}"/><path class="leaf-right" d="${LINNYA_MARK_PARTS.leafRight}"/></g></svg>
<h1>${escapeHtml(copy.title)}</h1>
<p>${escapeHtml(copy.detail)}</p>
<div class="track" role="progressbar" aria-label="${escapeHtml(copy.title)}"><div class="fill"></div></div>
</body>
</html>
`;
}

function clampFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(1, Math.max(0, fraction));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
