/**
 * Windows / Office 与 macOS 之间同字形风格的字体对照，按优先级排列。
 *
 * 请求字体本机没有时，通用打分只知道“同脚本”，可能把宋体换成日文明朝、把中宋换成繁体黑体，
 * 西文的 Office 字体（Tw Cen MT、Aptos、Cambria）缺少参考度量时甚至会落到宋体的西文字形；
 * 这里先给出同书体、同地区字形的候选。候选仍须本机已安装且 cmap 覆盖正文，否则回到通用打分。
 * 只收录系统自带或系统按需下载的字体，不写入任何第三方字体。
 */
const EQUIVALENT_GROUPS: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
  // 简体宋 / 明
  [['SimSun', 'NSimSun', '宋体', '新宋体', 'STSong', '华文宋体'], ['Songti SC', 'STSong', 'SimSun']],
  [['STZhongsong', '华文中宋'], ['Songti SC', 'STSong', 'SimSun']],
  [['Songti SC'], ['SimSun', 'STSong', 'STZhongsong']],
  // 简体黑
  [['SimHei', '黑体', 'STHeiti', '华文黑体', 'STXihei', '华文细黑'], ['Heiti SC', 'STHeiti', 'PingFang SC', 'SimHei', 'Microsoft YaHei']],
  [['Microsoft YaHei', '微软雅黑', 'Microsoft YaHei UI', 'DengXian', '等线'], ['PingFang SC', 'Heiti SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'DengXian']],
  [['PingFang SC', 'Hiragino Sans GB', 'Heiti SC'], ['Microsoft YaHei', 'DengXian', 'SimHei']],
  // 简体楷、仿宋
  [['KaiTi', '楷体', 'KaiTi_GB2312', 'STKaiti', '华文楷体'], ['Kaiti SC', 'STKaiti', 'KaiTi']],
  [['Kaiti SC'], ['KaiTi', 'STKaiti']],
  [['FangSong', '仿宋', 'FangSong_GB2312', 'STFangsong', '华文仿宋'], ['STFangsong', 'FangSong']],
  // 简体书法类
  [['STXingkai', '华文行楷'], ['Xingkai SC', 'STXingkai', 'Kaiti SC', 'KaiTi']],
  [['STXinwei', '华文新魏'], ['Weibei SC', 'STXinwei', 'Kaiti SC', 'KaiTi']],
  [['STLiti', '华文隶书', 'LiSu', '隶书'], ['Libian SC', 'STLiti', 'LiSu']],
  // 繁体
  [['Microsoft JhengHei', '微軟正黑體', 'Microsoft JhengHei UI'], ['PingFang TC', 'Heiti TC', 'Microsoft JhengHei']],
  [['PingFang TC', 'Heiti TC'], ['Microsoft JhengHei']],
  [['MingLiU', 'PMingLiU', '細明體', '新細明體'], ['Songti TC', 'LiSong Pro', 'PMingLiU', 'MingLiU']],
  [['Songti TC'], ['PMingLiU', 'MingLiU']],
  // 日文
  [['Yu Gothic', 'YuGothic', 'Meiryo', 'メイリオ', 'MS Gothic', 'MS PGothic'], ['Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'YuGothic', 'Yu Gothic', 'Meiryo']],
  [['Yu Mincho', 'YuMincho', 'MS Mincho', 'MS PMincho'], ['Hiragino Mincho ProN', 'YuMincho', 'Yu Mincho', 'MS Mincho']],
  [['Hiragino Sans', 'Hiragino Kaku Gothic ProN'], ['Yu Gothic', 'Meiryo']],
  [['Hiragino Mincho ProN'], ['Yu Mincho', 'MS Mincho']],
  // 韩文
  [['Malgun Gothic', '맑은 고딕', 'Gulim', '굴림', 'Dotum', '돋움'], ['Apple SD Gothic Neo', 'Malgun Gothic']],
  [['Batang', '바탕', 'Gungsuh', '궁서'], ['AppleMyungjo', 'Batang']],
  [['Apple SD Gothic Neo'], ['Malgun Gothic']],
  [['AppleMyungjo'], ['Batang']],
  // 西文：Office 字体在 Mac 上常缺（未装 Office 字体包），按书体对到系统字体
  [['Tw Cen MT', 'Tw Cen MT Condensed', 'Century Gothic'], ['Futura', 'Avenir Next', 'Helvetica Neue']],
  [['Aptos', 'Aptos Display', 'Aptos Narrow', 'Segoe UI', 'Franklin Gothic Book', 'Franklin Gothic Medium'], ['Helvetica Neue', 'Arial']],
  [['Cambria'], ['Georgia', 'Times New Roman']],
  [['Consolas'], ['Menlo', 'Monaco', 'Courier New']],
  [['Helvetica Neue', 'Helvetica'], ['Arial']],
  [['Menlo', 'Monaco'], ['Consolas', 'Courier New']],
];

const EQUIVALENT_INDEX: ReadonlyMap<string, readonly string[]> = new Map(
  EQUIVALENT_GROUPS.flatMap(([requested, equivalents]) => requested.map((family) => [
    normalize(family),
    equivalents.filter((equivalent) => normalize(equivalent) !== normalize(family)),
  ] as const)),
);

/** 返回请求 family 的同风格候选 family，按优先级排列；未收录时返回空数组。 */
export function crossPlatformEquivalentFamilies(family: string): readonly string[] {
  return EQUIVALENT_INDEX.get(normalize(family)) ?? [];
}

function normalize(family: string): string {
  return family.trim().toLocaleLowerCase('en-US');
}
