import type { DataUpgradeWindowCopy } from '../definitions/dataUpgradeWindow';

/** 与 linnya-design/logo/linnya-mark.svg 一致的品牌标记。 */
const LINNYA_MARK_PATH =
  'M12.18 13C10.78 9.37 12.65 6.05 18.33 2.04C17.99 8.85 16.33 12.29 12.82 13.38C13.29 11.46 14.25 9.01 15.66 6.6C14.09 8.81 12.91 11.11 12.18 13Z'
  + 'M10.1 22.3C9.9 20.44 10.41 18.54 10.89 16.75C11.18 15.66 11.65 14.59 12.34 13.69C12.44 14.83 12.07 15.97 11.64 17.01C10.95 18.72 10.33 20.46 10.1 22.3Z'
  + 'M11.4 13.4C8.22 13.61 5.8 12.03 4.27 8.77C8.01 8.63 10.43 10.2 11.4 13.4Z';

const LINNYA_MARK_COLOR = '#49A55C';

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
 * 颜色取 Renderer 设计 token 的实际值（背景、主文本、三级文本、轨道、强调色），随系统深浅色切换。
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
  --track: #ededed;
  --fill: #347b45;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: ${DATA_UPGRADE_WINDOW_BACKGROUND.dark};
    --text: #ededed;
    --muted: #a3a3a3;
    --track: #333333;
    --fill: #49a55c;
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
.mark { width: 56px; height: 56px; margin-bottom: 20px; }
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
  background: var(--fill);
  transition: width 400ms ease;
}
.sheen {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--fill) 45%, transparent), transparent);
  animation: sheen 1600ms ease-in-out infinite;
}
@keyframes sheen {
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
}
@media (prefers-reduced-motion: reduce) {
  .sheen { display: none; }
  .fill { transition: none; }
}
</style>
</head>
<body>
<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="${LINNYA_MARK_COLOR}" d="${LINNYA_MARK_PATH}"/></svg>
<h1>${escapeHtml(copy.title)}</h1>
<p>${escapeHtml(copy.detail)}</p>
<div class="track" role="progressbar" aria-label="${escapeHtml(copy.title)}"><div class="fill"></div><div class="sheen"></div></div>
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
