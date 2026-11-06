const messages = {
  canvas_endpoint_missing: '连线端点不存在，请重新 read/show 确认卡片编号。',
  canvas_self_connection: '不支持自连线，请连接两张不同的卡片。',
  canvas_duplicate_connection: '同方向连线已存在，请更新原连线而非重复创建。',
  canvas_group_cycle: '分组不能成环，请检查 parentId。',
  canvas_group_parent_missing: '分组父卡不存在，请重新读取画布。',
  canvas_placement_target_missing:
    '放置目标不存在，请重新 read/show 确认 near/after/in 的卡片编号。',
  canvas_agent_coordinates: 'Agent 不能指定坐标，请使用 near/side 或连接卡片。',
  canvas_duplicate_ref: '本批临时引用重复，请给每个新元素使用不同的 ref。',
} as const;

/** 可由调用方修正的提交错误必须越过CLI边界，不能退化为未知运行异常。 */
export class CanvasCommitFailure extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}
