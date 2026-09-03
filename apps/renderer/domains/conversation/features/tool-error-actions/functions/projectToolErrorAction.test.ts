import { describe, expect, it } from 'vitest';
import { IMAGE_GENERATION_TOOL_ERROR_CODES } from '@app/schemas';
import { projectToolErrorAction } from './projectToolErrorAction';

describe('projectToolErrorAction', () => {
  it('把未配置图片模型投影到现有添加模型设置页', () => {
    expect(projectToolErrorAction(IMAGE_GENERATION_TOOL_ERROR_CODES.modelNotConfigured)).toEqual({
      messageKey: 'conversation.tool.error.imageModelNotConfigured',
      actionLabelKey: 'conversation.tool.error.configureImageModel',
      settingsTabId: 'model',
    });
  });

  it('未知业务错误不制造无依据的修复动作', () => {
    expect(projectToolErrorAction('tool.unknown')).toBeUndefined();
    expect(projectToolErrorAction(undefined)).toBeUndefined();
  });
});
