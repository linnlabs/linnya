export function extractKnowledgeBaseErrorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim().length > 0) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const data = error.response?.data ?? error;
    if (typeof data.detail === 'string' && data.detail.trim().length > 0) {
      return data.detail;
    }
    if (typeof data.message === 'string' && data.message.trim().length > 0) {
      return data.message;
    }
    if (typeof data.error === 'string' && data.error.trim().length > 0) {
      return data.error;
    }
  }

  return null;
}
