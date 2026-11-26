import { describe, expect, it } from 'vitest';
import { KnowledgeVectorStartupError, readKnowledgeVectorStartupFailureKind, isQdrantRuntimeUnavailableError } from './errors';

function hostError(reason?: string): Error {
  const error = new Error('向量库没有启动成功');
  error.name = 'QdrantRuntimeUnavailableError';
  if (reason !== undefined) Reflect.set(error, 'reason', reason);
  return error;
}

describe('知识库向量服务启动失败的分类', () => {
  it('Host 判定运行时缺失：提示卸载保留资料后重新安装，不再提示停启', () => {
    const error = new KnowledgeVectorStartupError(hostError('runtime-missing'));
    expect(error.kind).toBe('runtime-missing');
    expect(error.message).toMatch(/卸载知识库（保留资料）后重新安装/u);
    expect(error.message).not.toMatch(/停用并重新启用/u);
    expect(isQdrantRuntimeUnavailableError(error)).toBe(true);
  });

  it('Host 判定 Windows 数据目录太长：提示换短目录后重启，停启无效不再提示', () => {
    const error = new KnowledgeVectorStartupError(hostError('data-directory-too-long'));
    expect(error.kind).toBe('data-directory-too-long');
    expect(error.message).toMatch(/LINNYA_WORKSPACE_DIR/u);
    expect(error.message).toMatch(/重启 Linnya/u);
    expect(error.message).not.toMatch(/停用并重新启用/u);
  });

  it('其他启动失败、缺少原因字段或不是 Host 错误：仍提示排除故障后停启', () => {
    for (const cause of [hostError('startup-failed'), hostError(), new Error('spawn EACCES'), 'not an error', undefined]) {
      const error = new KnowledgeVectorStartupError(cause);
      expect(error.kind).toBe('startup-failed');
      expect(error.message).toMatch(/停用并重新启用/u);
    }
  });

  it('只认 Host 错误名称与原因字段，不依赖类身份', () => {
    expect(readKnowledgeVectorStartupFailureKind(hostError('runtime-missing'))).toBe('runtime-missing');
    const sameReasonOtherName = new Error('x');
    Reflect.set(sameReasonOtherName, 'reason', 'data-directory-too-long');
    expect(readKnowledgeVectorStartupFailureKind(sameReasonOtherName)).toBe('startup-failed');
    expect(readKnowledgeVectorStartupFailureKind({ name: 'QdrantRuntimeUnavailableError', reason: 'runtime-missing' })).toBe('startup-failed');
  });
});
