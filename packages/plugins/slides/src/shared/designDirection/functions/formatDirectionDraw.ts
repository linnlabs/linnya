import {
  IMAGELESS_IMAGE_STRATEGY_IDS,
  type DirectionDraw,
} from '../definitions/directionContract';

function colorLogicLines(draw: DirectionDraw): string[] {
  return [
    `配色逻辑：${draw.colorLogic.name}。${draw.colorLogic.guide}`,
    draw.hue
      ? `主色相：${draw.hue.name}（参考色 ${draw.hue.reference}）。主色或信号色取这个色相，深浅和浓淡不必照抄参考色，其余颜色按配色逻辑配。`
      : '主色相：从主图里取样，不另定色相。',
  ];
}

function imagePaletteLines(draw: DirectionDraw): string[] {
  return [
    '配色：找齐封面和主要内页的图后，在 Shell 运行 `linnya palette suggest <图片...>`（第一张放主图），从返回的几套里按内容选一套，不必选第一套，全稿颜色都从这一套取。',
    '下面的配色逻辑只在两种情况下用：图里取不出颜色（返回 no_subject_color），或本稿最后没用照片。',
    ...colorLogicLines(draw),
  ];
}

/** 给 Agent 的方向说明：讲清要用的方法，以及在 deck.js 里如何声明与贯彻。 */
export function formatDirectionDrawForAgent(draw: DirectionDraw): string {
  const { card } = draw;
  const usesImages = !IMAGELESS_IMAGE_STRATEGY_IDS.includes(draw.imageStrategy.id);
  const lines = [
    `本稿视觉方向（${draw.drawId}）`,
    '',
    `手法：${card.name}——${card.borrows}`,
    `怎么贯彻：${card.apply}`,
    `常见失败：${card.pitfalls}`,
    '',
    ...(usesImages ? imagePaletteLines(draw) : colorLogicLines(draw)),
    `字体：${draw.typeStrategy.name}。${draw.typeStrategy.guide}`,
    `图片：${draw.imageStrategy.name}。${draw.imageStrategy.guide}`,
    `封面构图：${draw.coverComposition.name}。${draw.coverComposition.guide}这只定标题与主体的位置，比例、裁切和元素按内容决定。`,
    draw.motif ? `内容母题：${draw.motif}。用它构成封面与章节页，并在内页以小尺度重复出现。` : '内容母题：自行从内容里选一个具体母题。',
    '',
    '执行要求：',
    '1. 把以上落成具体方向，写进 ppt_plan 的 visualDirection（理念、构图、记忆点），用你自己的话描述，不要提“签”或“抽取”。',
    `2. deck.js 顶部写一个 direction 对象 ${usesImages ? '{ drawId, cardId, palette: { backgrounds, ink, muted, accents, chart }, imagePalette, fonts }' : '{ drawId, cardId, palette: { backgrounds, ink, accents }, fonts }'}，颜色、字体和图表调色板都从它取值，并在 compose({ theme: { ..., direction } }) 里声明：`,
    `   drawId 写 "${draw.drawId}"，cardId 写 "${card.id}"；palette 写全稿用到的背景色、正文墨色与强调色，fonts 写全稿用到的字体。确实要加颜色或字体时，先补进 direction 再用。`,
    ...(usesImages
      ? ['   用了取色结果时：bg、sf 进 backgrounds，mu 进 muted，ac 进 accents，ch 进 chart；imagePalette 写 { id: 这一套的编号, excludedHues: 排除色相的起止度数 }，例如“排除 品红315°-15°”写 [[315, 15]]。取不出颜色写 { unavailable: "no_subject_color" }，最后没用照片写 { unavailable: "no_photos" }。']
      : []),
    '3. 手法要贯彻到每一页，包括图表系列色、表格表头、页眉页码；inspect 会逐页对照背景、字体与颜色，中途换回别的底色或字体会被报出来。',
    '4. 手法只决定表达方式，内容要求、数据核对、字号下限与已有设计规则不变。',
    `5. 如果这个手法明显不适合本稿内容，再调用 ppt_direction 并在 rejected 里写明 cardId "${card.id}" 与理由；不要因为不熟悉就退回。`,
  ];
  return lines.join('\n');
}
