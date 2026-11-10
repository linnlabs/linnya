import { expect, it } from 'vitest';
import { PluginDocumentImageAssetError } from '@plugin/backend/documentImageAsset';
import { isCanvasUserFailureCode } from '../../../shared';
import { projectCanvasBusinessFailure } from '../projectCanvasCliFailure';

it('图片格式和体积失败投影成稳定编号，其余存储故障仍算运行错误', () => {
  expect(
    projectCanvasBusinessFailure(new PluginDocumentImageAssetError('invalid_media'))?.code
  ).toBe('canvas_image_unsupported');
  expect(
    projectCanvasBusinessFailure(new PluginDocumentImageAssetError('media_limit_exceeded'))?.code
  ).toBe('canvas_image_too_large');
  expect(projectCanvasBusinessFailure(new PluginDocumentImageAssetError('store_unavailable'))).toBe(
    null
  );
});

it('只有用户可能遇到的失败编号才交给 Renderer 换文案，其余失败文字原样显示', () => {
  expect(isCanvasUserFailureCode('canvas_image_unsupported')).toBe(true);
  expect(isCanvasUserFailureCode('canvas_image_too_large')).toBe(true);
  expect(isCanvasUserFailureCode('read_only_format')).toBe(true);
  expect(isCanvasUserFailureCode('request_id_payload_mismatch')).toBe(false);
  expect(isCanvasUserFailureCode('画布操作失败，详细原因已记录到日志。')).toBe(false);
});
