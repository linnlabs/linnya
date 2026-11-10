import { defineCanvasMessages } from '../../functions/defineCanvasMessages';

/** 后端回传的失败编号对应的界面文案；键名是 `canvas.failure.<编号>`。 */
export const FAILURE_MESSAGES = defineCanvasMessages(
  {
    'canvas.failure.canvas_image_unsupported': '这张图片无法使用，请换成 PNG、JPEG 或 WebP 格式。',
    'canvas.failure.canvas_image_too_large': '图片太大，请压缩后重试。',
    'canvas.failure.canvas_invalid_request': '画布操作字段无效，请刷新后重试。',
    'canvas.failure.canvas_operation_failed': '画布操作失败，详细原因已记录到日志。',
    'canvas.failure.document_missing': '画布不存在或已删除',
    'canvas.failure.selection_removed': '所选卡片已全部移除，没有可复制的内容',
    'canvas.failure.outside_project': '不能读取其他项目的画布',
    'canvas.failure.wrong_document_type': '目标不是 Linnya 画布',
    'canvas.failure.runtime_closed': '画布运行态已停用，请重新打开后重试',
    'canvas.failure.view_closed': '画布视图已关闭，请重新打开后重试',
    'canvas.failure.read_only_format':
      '画布含本版本无法无损处理的内容，已只读打开；原始元素未修改。请使用支持该格式的版本。',
    'canvas.failure.unmanaged_image':
      '画布内插图尚未接管为图片资产，请通过插入图片或粘贴图片文件导入；本批未保存，草稿仍保留。',
    'canvas.failure.canvas_endpoint_missing': '连线端点已不存在，请刷新画布后重试。',
    'canvas.failure.canvas_self_connection': '不支持自连线，请连接两张不同的卡片。',
    'canvas.failure.canvas_duplicate_connection': '同方向连线已存在，请更新原连线而非重复创建。',
    'canvas.failure.canvas_group_cycle': '分组不能成环，请调整分组关系。',
    'canvas.failure.canvas_group_parent_missing': '分组的上级卡片已不存在，请刷新画布后重试。',
    'canvas.failure.canvas_element_not_found': '元素已不存在，请刷新画布后重试。',
    'canvas.failure.canvas_layout_timeout': '布局计算超时，本批没有提交；缩小范围后再试。',
    'canvas.failure.canvas_layout_queue_full': '布局队列已满，请稍后重试。',
    'canvas.failure.canvas_layout_cancelled': '布局已取消。',
    'canvas.failure.canvas_approval_denied': '用户已拒绝此批次，不能用同一请求再次执行。',
    'canvas.failure.canvas_approval_replaced': '此批次已被新待确认批次替换。',
    'canvas.failure.canvas_approval_withdrawn': '此批次所属改动已撤回。',
    'canvas.failure.canvas_approval_closed': '此批次所属改动组已经完成。',
    'canvas.failure.canvas_group_missing': '改动组已不存在，请刷新画布后重试。',
    'canvas.failure.canvas_approval_expired': '待确认操作已失效，请刷新画布查看当前批次。',
    'canvas.failure.canvas_history_head_changed':
      '后续操作已改变撤销顺序，请使用画布撤销逐步处理。',
    'canvas.failure.cancelled': '操作已取消。',
  },
  {
    'canvas.failure.canvas_image_unsupported':
      "This image can't be used. Use a PNG, JPEG, or WebP image.",
    'canvas.failure.canvas_image_too_large': 'This image is too large. Compress it and try again.',
    'canvas.failure.canvas_invalid_request':
      'The canvas request was invalid. Refresh and try again.',
    'canvas.failure.canvas_operation_failed':
      'The canvas operation failed. Details were written to the log.',
    'canvas.failure.document_missing': "This canvas doesn't exist or was deleted.",
    'canvas.failure.selection_removed':
      'The selected cards were all removed, so there is nothing to copy.',
    'canvas.failure.outside_project': "Canvases from other projects can't be read.",
    'canvas.failure.wrong_document_type': 'The target is not a Linnya canvas.',
    'canvas.failure.runtime_closed':
      'The canvas runtime was stopped. Reopen the canvas and try again.',
    'canvas.failure.view_closed': 'The canvas view was closed. Reopen it and try again.',
    'canvas.failure.read_only_format':
      "This canvas contains content this version can't handle losslessly, so it opened read-only. Original elements were not changed. Use a version that supports this format.",
    'canvas.failure.unmanaged_image':
      'An image in the canvas is not yet managed as an image asset. Import it by inserting an image or pasting an image file. This batch was not saved and the draft is kept.',
    'canvas.failure.canvas_endpoint_missing':
      'A connection endpoint no longer exists. Refresh the canvas and try again.',
    'canvas.failure.canvas_self_connection':
      "A card can't connect to itself. Connect two different cards.",
    'canvas.failure.canvas_duplicate_connection':
      'A connection in this direction already exists. Edit it instead of creating another.',
    'canvas.failure.canvas_group_cycle':
      "Groups can't contain each other in a loop. Adjust the grouping.",
    'canvas.failure.canvas_group_parent_missing':
      "The group's parent card no longer exists. Refresh the canvas and try again.",
    'canvas.failure.canvas_element_not_found':
      'This element no longer exists. Refresh the canvas and try again.',
    'canvas.failure.canvas_layout_timeout':
      'Layout timed out and nothing was applied. Try a smaller selection.',
    'canvas.failure.canvas_layout_queue_full': 'The layout queue is full. Try again shortly.',
    'canvas.failure.canvas_layout_cancelled': 'Layout cancelled.',
    'canvas.failure.canvas_approval_denied':
      'This batch was rejected and cannot be run again with the same request.',
    'canvas.failure.canvas_approval_replaced': 'This batch was replaced by a newer pending batch.',
    'canvas.failure.canvas_approval_withdrawn': 'The changes in this batch were withdrawn.',
    'canvas.failure.canvas_approval_closed': 'The change group for this batch is already finished.',
    'canvas.failure.canvas_group_missing':
      'The change group no longer exists. Refresh the canvas and try again.',
    'canvas.failure.canvas_approval_expired':
      'The pending action has expired. Refresh the canvas to see the current batch.',
    'canvas.failure.canvas_history_head_changed':
      'Later actions changed the undo order. Use canvas undo to step through them.',
    'canvas.failure.cancelled': 'Cancelled.',
  }
);
