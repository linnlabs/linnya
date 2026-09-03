/**
 * AestheticLint 阈值常量（单一真源）
 *
 * 所有规则用到的"魔法数字"集中在这里，方便：
 * - lintRules / repetition / scoring 三个模块共享同一份阈值；
 * - 调阈值时只动一处，不再去 1000+ 行的主类里翻；
 * - 测试 / 文档 / 工具入口可以直接引用同一组常量做边界测试。
 *
 * **加新阈值时**：写清单位 + 经验来源 + 调高/调低的影响（参考下方既有注释格式），
 * 不要只写裸数字。lint 阈值一旦失去解释，就会变成"谁也不敢动"的死值。
 */

/**
 * Scene Graph DSL 生成的页面元素数量通常较多
 * （文本 + 装饰 shape + spacer + 图表等），
 * 30-40 个元素属于正常的高密度咨询风格。
 */
export const MAX_ELEMENTS_PER_SLIDE = 50;

/**
 * 文本框边界面积占 slide 面积比的阈值。
 * 注意：这是边界框面积，不是实际文字覆盖率，文本框内部有大量留白。
 * 咨询风格 PPT 标题 + 正文 + 注释 + 来源行等多个文本框，60-70% 属于正常。
 */
export const TEXT_DENSITY_HIGH = 0.75;
export const TEXT_DENSITY_LOW = 0.02;

/** 最大字号 - 最小字号 < 此值视为层级不足 */
export const MIN_FONT_SIZE_RANGE = 4;

/** 左右或上下留白差异比 */
export const WHITESPACE_IMBALANCE = 0.4;

/**
 * 页面结构相似度阈值。
 * 咨询风格 PPT 大量页面使用相同模板，结构相似度 90%+ 属于正常。
 * 只有结构 AND 内容都高度一致时才真正构成重复。
 */
export const SIMILARITY_THRESHOLD = 0.95;

// ─── P1 Tier-1 Thresholds ──────────────────────────────────────────────────

/**
 * 任意文本字号低于此值 → 高风险 warning：在常见投影场景几乎不可读。
 * 5pt ≈ 1.76mm，投影场景几乎无法辨认。
 */
export const FONT_SIZE_NEAR_UNREADABLE_PT = 5;

/**
 * 字号低于此值 → warning：屏幕近看勉强，投影不友好。
 * 6.5pt 是参考 PowerPoint 默认 footer/source 的常见下限。
 */
export const FONT_SIZE_RECOMMENDED_FLOOR_PT = 6.5;

/** 脚注、来源、图注和坐标轴标签的建议下限；仍受 5pt 近不可读阈值约束。 */
export const FONT_SIZE_ANNOTATION_RECOMMENDED_FLOOR_PT = 5.5;

/**
 * 单页字号档位聚类粒度（pt）。差异 ≤ 该值的字号归为同一档。
 * 0.5pt 能兼容部分渲染引擎的微量抖动，同时避免把刻意区分的 16/16.5 合并。
 */
export const FONT_SIZE_TIER_GRANULARITY_PT = 0.5;

/**
 * 单页字号档位数上限。>4 档通常意味着层级信号失焦。
 * 典型页面：主标题 / 副标题 / 正文 / 注释 = 4 档已足够。
 */
export const FONT_SIZE_TIER_LIMIT = 4;

/**
 * 每种主导脚本允许的 resolved 字体族数量上限。
 * 按脚本分别统计，避免把 Latin + CJK 的正常主题配对误算为两套混乱字体。
 */
export const FONT_FAMILY_COUNT_PER_SCRIPT_LIMIT = 2;

/**
 * 元素与画布边缘的最小留白（英寸）。
 *
 * 阈值 0.15" ≈ 3.8mm，是肉眼真正会觉得"贴上"的物理距离上限——
 * 投影/打印的安全裁切区也基本能覆盖到这个范围。
 *
 * **设计哲学**：建议高、审查宽。
 * - Skill 设计建议只要求主动留出舒适安全区，不复制本模块阈值；
 * - lint 阈值取 0.15"，是"绝不能低于"的硬下限，避免对 footer/页码等
 *   惯例性贴边元素持续误报（这些元素几何上常落在 0.15"–0.3" 区间）。
 *
 * 低于此值视为贴边——除非元素本身就是 full-bleed（见 FULL_BLEED_*）。
 */
export const EDGE_MARGIN_MIN_IN = 0.15;

/**
 * "全幅元素"判定阈值：bbox 占画布对应方向 ≥ 该比例，则该方向豁免贴边检查。
 * 95% 是经验值——既能覆盖背景图 / 全幅色块（典型 100%），
 * 又不会把"做了大留白的咨询风装饰条"误判为 full-bleed。
 * **轴独立**：水平 full-bleed 不豁免上下贴边检查，反之亦然。
 */
export const FULL_BLEED_RATIO = 0.95;

/**
 * 单页非中性主色 hue 簇上限。≤ 该值视为色彩使用克制；超出 → warning。
 * 4 = 主色 + 强调色 + 第二强调 + 警示色（极限），多于此通常是配色失控。
 */
export const PALETTE_HUE_BUCKET_LIMIT = 4;

/**
 * Hue 聚类粒度（度）。差异 ≤ 此值视为同色簇。
 * 30° ≈ 把色环 12 等分（红/橙/黄/绿/青/蓝/紫各占 1-2 格）。
 * 太大（60°）会把"蓝色 + 青色"合并；太小（10°）易把同主色的浅深 tone 误判为多色。
 */
export const HUE_CLUSTER_GRANULARITY_DEG = 30;

/**
 * 跨页主色 hue 漂移阈值（圆形 stddev，单位：度）。
 * 25° 经验值：保留正常的"主色 + 1-2 个强调色穿插"，
 * 但能捕捉到"每页都换主色"或"红/绿/蓝主题随机用"的真正紊乱。
 */
export const PRIMARY_HUE_DRIFT_THRESHOLD_DEG = 25;

/**
 * WCAG 文本-背景对比度阈值。低于此值 → warning。
 * 3.0 = WCAG AA 大字体最低要求；正文（< 18pt）官方要求 4.5。
 * 我们统一用 3.0 作为"明显不可读"的警戒线，避免对小色块过度报警。
 */
export const TEXT_CONTRAST_MIN_RATIO = 3.0;

/**
 * 图片 fit=stretch 时允许的宽高比偏差。> 该值 → warning。
 * 10% 偏差肉眼可见（如证件照拉伸为 16:9）；
 * 5% 多数人看不出，避免误报 1px 抖动。
 */
export const IMAGE_ASPECT_TOLERANCE = 0.1;

/**
 * 图表标签估算所需跨度 / 实际可用跨度超过该值才报告容量风险。
 * 1.35 为 ECharts 自动间隔、字体宽度估算误差和短标签微调保留 35% 余量；
 * 调低会把正常的紧凑图表误报为拥挤，调高会漏掉明显跳标或碰撞。
 */
export const CHART_LABEL_CAPACITY_RISK_RATIO = 1.35;

/** 标签单行高度相对字号 em 的保守倍数，用于纵向容量估算。 */
export const CHART_LABEL_LINE_HEIGHT_RATIO = 1.25;
