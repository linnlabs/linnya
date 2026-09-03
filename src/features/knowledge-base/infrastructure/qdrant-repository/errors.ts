/**
 * @file src/features/knowledge-base/infrastructure/qdrant-repository/errors.ts
 *
 * @brief Qdrant 相关错误识别工具
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 功能：判断错误是否表示“集合已存在”（如 409 Conflict）
 *
 * 说明：不同 HTTP 客户端/SDK 的错误结构不一致，这里只做可验证的判断，不做猜测性分支。
 */
export function isCollectionAlreadyExistsError(error: unknown): boolean {
  try {
    if (isRecord(error)) {
      const status = error['status'];
      const statusText = error['statusText'];
      if (status === 409) return true;
      if (typeof statusText === 'string' && statusText.toLowerCase() === 'conflict') return true;

      const response = error['response'];
      if (isRecord(response) && response['status'] === 409) return true;
    }

    const text = JSON.stringify(error);
    return typeof text === 'string' && /already exists/i.test(text);
  } catch (_) {
    return false;
  }
}



