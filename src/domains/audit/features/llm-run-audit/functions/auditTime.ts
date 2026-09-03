export function formatBeijingTime(input: Date): string {
  const date = new Date(input.getTime() + 8 * 60 * 60 * 1000);
  const yyyy = date.getUTCFullYear();
  const mm = pad2(date.getUTCMonth() + 1);
  const dd = pad2(date.getUTCDate());
  const hh = pad2(date.getUTCHours());
  const mi = pad2(date.getUTCMinutes());
  const ss = pad2(date.getUTCSeconds());
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms} (UTC+8)`;
}

export function formatBeijingTimePrefixForPath(input: Date): string {
  const date = new Date(input.getTime() + 8 * 60 * 60 * 1000);
  const yyyy = date.getUTCFullYear();
  const mm = pad2(date.getUTCMonth() + 1);
  const dd = pad2(date.getUTCDate());
  const hh = pad2(date.getUTCHours());
  const mi = pad2(date.getUTCMinutes());
  const ss = pad2(date.getUTCSeconds());
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}_BJT`;
}

export function formatLocalTimePrefixForPath(input: Date): string {
  const yyyy = input.getFullYear();
  const mm = pad2(input.getMonth() + 1);
  const dd = pad2(input.getDate());
  const hh = pad2(input.getHours());
  const mi = pad2(input.getMinutes());
  const ss = pad2(input.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
