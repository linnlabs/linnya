const normalizeReminderText = (raw: string): string | undefined => {
  const text = raw.trim();
  return text.length > 0 ? text : undefined;
};

/** 统一 System Reminder 标签格式；注入位置由各自调用场景决定。 */
export function formatSystemReminder(body: string): string | undefined {
  const normalized = normalizeReminderText(body);
  return normalized
    ? `<system-reminder>\n${normalized}\n</system-reminder>`
    : undefined;
}
