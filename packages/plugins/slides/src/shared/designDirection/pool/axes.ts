import type {
  ColorLogicId,
  DirectionAxisOption,
  DirectionBoldness,
  DirectionScenario,
  HueBin,
  ImageStrategyId,
  TypeStrategyId,
} from '../definitions/directionContract';
import type { CoverCompositionId } from '../definitions/coverComposition';

export const COLOR_LOGICS: readonly DirectionAxisOption<ColorLogicId>[] = [
  { id: 'paper-ink', name: '染纸底配墨色', guide: '整页一种带色相的浅纸色（不要米白），文字用同色相的深墨，只留一种点题色。' },
  { id: 'white-signal', name: '白底多信号色', guide: '纯白底，三到四种高饱和信号色各代表一类事物，全稿固定对应关系；文字纯黑，不用渐变。' },
  { id: 'mono-depth', name: '单色相深浅', guide: '全稿只用一个色相，靠五六级深浅区分层级；图表系列也只用这一色相的深浅。' },
  { id: 'bw-signal', name: '黑白灰加一个信号色', guide: '版面只有黑白灰，一个高饱和信号色只标关键数字、关键线和当前位置。' },
  { id: 'dark-glow', name: '深底高亮', guide: '近黑或深色底，文字浅色，一到两种亮色点题；数据页可以换成浅底，但要成对出现。' },
  { id: 'photo-sampled', name: '从主图取色', guide: '背景和强调色都从封面主图里取样，全稿颜色像是照片的延伸；不另加无关颜色。' },
  { id: 'duotone-print', name: '双色套印', guide: '只用两种油墨色，叠印出第三种；照片也做成双色调。像一张双色印刷品。' },
  { id: 'primary-blocks', name: '纯色块面', guide: '大面积纯色块分割版面，三种饱和色加黑白；块面就是构图，不是卡片底。' },
  { id: 'pastel-field', name: '整页浅彩底', guide: '每一章换一种浅彩底（不是米白），文字用该色的深色；章节靠底色区分。' },
  { id: 'earth-tones', name: '矿物土色', guide: '赭石、砖红、橄榄、褐、石青这类矿物颜料色，低饱和，像颜料和泥土。' },
];

export const TYPE_STRATEGIES: readonly DirectionAxisOption<TypeStrategyId>[] = [
  { id: 'heavy-sans', name: '粗黑大字', guide: '标题用微软雅黑 Bold 或黑体，封面标题占版面一半以上；正文等线或微软雅黑。' },
  { id: 'book-serif', name: '宋体书卷', guide: '标题和正文都用宋体/仿宋，引文用楷体，西文和数字用 Georgia 或 Garamond。' },
  { id: 'mono-technical', name: '等宽工程字', guide: '编号、数字、标签用 Consolas 或 Courier New，中文用等线；像工程文件。' },
  { id: 'serif-sans-mix', name: '衬线标题配无衬线正文', guide: '标题宋体或 Georgia，正文等线或微软雅黑；两种字体各司其职，不混用。' },
  { id: 'display-image', name: '下载展示字体', guide: '封面和章节标题用一款许可明确的开源展示字体，自己下载后渲染成透明 PNG；正文仍用 Office 字体，并在末页注明字体与许可。' },
  { id: 'numeral-hero', name: '数字当主角', guide: '关键数字用 Arial Black、Impact 或 Georgia 做超大字号，文字退居说明。' },
  { id: 'calligraphy', name: '书法字', guide: '封面和章节用开源书法字体渲染成透明 PNG，正文宋体或楷体；书法字只用在少数几页。' },
  { id: 'condensed-label', name: '窄体标签', guide: '西文标签用 Arial Narrow 或 Tw Cen MT 加大字距，中文用黑体；小标签成为版面的骨架。' },
];

export const IMAGE_STRATEGIES: readonly DirectionAxisOption<ImageStrategyId>[] = [
  { id: 'documentary-color', name: '纪实彩照', guide: '现场、人物、产品的真实照片，满版或大幅；同一稿的照片色调要统一。' },
  { id: 'archival-bw', name: '黑白档案照', guide: '所有照片统一去色，加一点颗粒；黑白照片配色块或信号色。' },
  { id: 'macro-detail', name: '局部特写', guide: '放大到纹理、零件、材料的局部，用裁切讲细节，整体图只出现一次。' },
  { id: 'diagram-only', name: '只用图解', guide: '不用照片，所有画面都是自己画的示意图、线框、流程和结构图。' },
  { id: 'maps-plans', name: '地图与图纸', guide: '用地图、平面图、剖面、图纸作主视觉，标注线与编号贯穿全稿。' },
  { id: 'cutout-objects', name: '去背物件', guide: '物件或产品去背后直接压在版面上，配贴地阴影；不加相框。' },
  { id: 'generated-illustration', name: '生成插画', guide: '用生图模型生成统一画风的插画作为封面主图和章节图；同一稿只用一种画风。' },
  { id: 'typographic', name: '以字为画', guide: '几乎不用图，画面靠超大字、数字和排版本身。' },
];

/** 封面重心：只说标题与主体放在哪里，不给坐标和比例。 */
export const COVER_COMPOSITIONS: readonly DirectionAxisOption<CoverCompositionId>[] = [
  { id: 'center-axis', name: '居中轴线', guide: '标题落在画面中轴，主体或图片在标题正后方或正下方，左右大致对称；适合仪式感强、只有一个主体的稿子。' },
  { id: 'bottom-band', name: '底部压题', guide: '上面大半是满版图或整块色面，标题和副题压在下方一条里，像海报或纪录片封面。' },
  { id: 'top-masthead', name: '刊头在上', guide: '标题横排在上部，像杂志刊头；主图、物件或关键数字在下面展开。' },
  { id: 'right-title', name: '标题在右', guide: '主体、图片或数字占左边，标题与信息靠右排，主体朝向标题。' },
  { id: 'vertical-axis', name: '竖排做轴', guide: '中文标题竖排成一根轴，其余信息和图围绕它布置；西文标题改成旋转 90° 的大字。' },
  { id: 'type-fill', name: '字就是画面', guide: '标题字放大到占版面一半以上，图片或色块只做衬底，或嵌进字里；不另摆一张图。' },
  { id: 'mosaic', name: '多格拼贴', guide: '三到六张图或色块组成网格或错落拼贴，标题嵌在其中一格，或压在格子交界处。' },
  { id: 'left-title', name: '左题右图', guide: '标题在左，右半边一张图；只在钩子正好是“一件东西加一句话”时合适。' },
];

/** 左题右图是模型最熟的封面，降权；多格拼贴离不开图片。 */
export const COVER_COMPOSITION_FACTORS: Readonly<Partial<Record<CoverCompositionId, number>>> = {
  'left-title': 0.25,
};
export const IMAGE_DEPENDENT_COVER_COMPOSITIONS: readonly CoverCompositionId[] = ['mosaic'];

/** OKLCH 彩度达到这个值，页面上才看得出色相；更低的是灰、墨和染纸，不算用了某个颜色。 */
export const VISIBLE_HUE_MIN_CHROMA = 0.03;

/**
 * 12 档主色相。度数是 OKLCH，分界与 color-core 的色相名一致，所以各档宽度不等；
 * 这里写成静态数据，因为方向定义会打进 build Worker。
 * 给 Agent 的是名称和一个参考色（深、中、浅三档按稿随机取一个，免得各稿照抄同一个色值），
 * 度数只用来把用过的颜色归档和算对面色相。
 */
export const HUE_BINS: readonly HueBin[] = [
  { bin: 0, from: 20, to: 42, name: '朱红', references: ['#802013', '#CB4832', '#EA6C58'] },
  { bin: 1, from: 42, to: 62, name: '铁锈橙', references: ['#6C3814', '#B05925', '#DE7A34'] },
  { bin: 2, from: 62, to: 88, name: '琥珀', references: ['#5E4114', '#D79628', '#C48C34'] },
  { bin: 3, from: 88, to: 115, name: '橄榄', references: ['#504914', '#716C26', '#A89A35'] },
  { bin: 4, from: 115, to: 138, name: '草绿', references: ['#3B5015', '#648828', '#81A835'] },
  { bin: 5, from: 138, to: 165, name: '翠绿', references: ['#18552E', '#258651', '#3CB266'] },
  { bin: 6, from: 165, to: 205, name: '青', references: ['#18524C', '#1C8580', '#3CADA0'] },
  { bin: 7, from: 205, to: 245, name: '湖蓝', references: ['#174F62', '#007CA5', '#3BA6CB'] },
  { bin: 8, from: 245, to: 280, name: '靛蓝', references: ['#123E9C', '#2C488E', '#6796F0'] },
  { bin: 9, from: 280, to: 318, name: '紫', references: ['#562990', '#6A499B', '#A77FEC'] },
  { bin: 10, from: 318, to: 350, name: '梅紫', references: ['#741A68', '#883C7A', '#D26EC1'] },
  { bin: 11, from: 350, to: 20, name: '胭脂', references: ['#7F1A3E', '#AF355C', '#E7688B'] },
];

/** 不需要另给色相的配色逻辑：颜色取自照片，或者整稿只有黑白（信号色另由色相给出）。 */
export const HUELESS_COLOR_LOGICS: readonly ColorLogicId[] = ['photo-sampled'];

/**
 * 同质化吸引子：基准里反复出现的默认样子，抽签时降权。
 * - 靛蓝/湖蓝主色（藏青配铜色是投研稿最常见的默认答案）；
 * - 染纸底配墨色（米白纸+深墨）。
 */
export const ATTRACTOR_HUE_BINS: readonly number[] = [7, 8];
export const ATTRACTOR_HUE_FACTOR = 0.35;
export const ATTRACTOR_COLOR_LOGIC_FACTOR: Readonly<Partial<Record<ColorLogicId, number>>> = {
  'paper-ink': 0.5,
};

/**
 * 色相与场景的适配：投研、汇报这类稿子不发粉色系（梅紫、胭脂），紫色降权；学术稿粉色系降权。
 * 键是 HUE_BINS 的 bin，未列出的按 1。
 */
export const SCENARIO_HUE_FACTORS: Readonly<Partial<Record<DirectionScenario, Readonly<Partial<Record<number, number>>>>>> = {
  business: { 9: 0.3, 10: 0, 11: 0 },
  academic: { 10: 0.3, 11: 0.3 },
};

export const DEFAULT_BOLDNESS_BY_SCENARIO: Readonly<Record<DirectionScenario, DirectionBoldness>> = {
  business: 'steady',
  academic: 'steady',
  teaching: 'balanced',
  culture: 'balanced',
  product: 'balanced',
  personal: 'bold',
};

/** 卡片自身稳妥度（1–3）在不同大胆偏好下的权重。 */
export const BOLDNESS_WEIGHTS: Readonly<Record<DirectionBoldness, readonly [number, number, number]>> = {
  steady: [1, 0.6, 0.12],
  balanced: [0.7, 1, 0.5],
  bold: [0.3, 0.8, 1],
};
