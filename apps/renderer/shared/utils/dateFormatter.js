/**
 * 格式化时间为用户友好的日期格式
 * @param {number} timestamp - 时间戳（毫秒）
 * @returns {string} 格式化后的日期字符串
 */
export function formatTime(timestamp, options) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();

  // 将时间归零以便比较日期
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 计算天数差（过去为正数，未来为负数）
  const daysDiff = Math.floor((nowOnly - dateOnly) / (1000 * 60 * 60 * 24));

  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  // 如果是今天，显示时分秒
  if (daysDiff === 0) {
    return `${hours}:${minutes}:${seconds}`;
  }
  // 如果是昨天
  if (daysDiff === 1) {
    return options.relativeLabels.yesterday;
  }
  // 如果是今年（但不是今天或昨天）
  if (year === now.getFullYear()) {
    return `${month}-${day}`;
  }
  // 如果不是今年，显示年-月-日
  return `${year}-${month}-${day}`;
}

/**
 * 格式化音频时长为 MM:SS 或 HH:MM:SS 格式
 * @param {number} seconds - 时长（秒）
 * @returns {string} 格式化后的时长字符串
 * 
 * @example
 * formatDuration(65) // "01:05"
 * formatDuration(3661) // "01:01:01"
 * formatDuration(0) // "00:00"
 */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) {
    return '00:00';
  }
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    // 如果有小时，显示 HH:MM:SS
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    // 如果没有小时，显示 MM:SS
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

/**
 * 根据日期（YYYY-MM-DD）和可选时间（HH:mm）生成友好的“待办日期”标签。
 *
 * 规则：
 * - 今天：如果有时间，显示 HH:mm；否则显示“今天”
 * - 昨天 / 前天：显示“昨天”/“前天”
 * - 明天 / 后天：显示“明天”/“后天”
 * - 今年其它日期：显示 MM-DD
 * - 其他年份：显示 YYYY-MM-DD
 *
 * @param {string} dateStr - 形如 "2025-03-21" 的日期字符串
 * @param {string} [timeStr] - 形如 "09:30" 的时间字符串（可选）
 * @returns {string} 格式化后的日期标签
 */
export function formatDueDateLabel(dateStr, timeStr) {
  if (!dateStr) return '';

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  const day = Number(dayStr);

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return dateStr;
  }

  const target = new Date(year, month, day);
  const now = new Date();

  const targetOnly = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffDays = Math.round((targetOnly - nowOnly) / (1000 * 60 * 60 * 24));

  // 今天：只显示时分（如果有），否则“今天”
  if (diffDays === 0) {
    if (timeStr) {
      // 确保是 HH:mm
      const [h = '00', m = '00'] = timeStr.split(':');
      return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    }
    return '今天';
  }

  if (diffDays === -1) return '昨天';
  if (diffDays === -2) return '前天';
  if (diffDays === 1) return '明天';
  if (diffDays === 2) return '后天';

  const month2 = (target.getMonth() + 1).toString().padStart(2, '0');
  const day2 = target.getDate().toString().padStart(2, '0');

  // 同一年：显示 MM-DD
  if (target.getFullYear() === now.getFullYear()) {
    return `${month2}-${day2}`;
  }

  // 跨年：显示 YYYY-MM-DD
  return `${target.getFullYear()}-${month2}-${day2}`;
}
