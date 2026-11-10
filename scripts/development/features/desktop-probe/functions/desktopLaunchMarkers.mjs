export function readDesktopCdpPort(output) {
  const line = output?.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\//);
  return line ? Number(line[1]) : undefined;
}

export function readDesktopReady(output) {
  const line = output?.match(/\[Desktop\] ready (\{[^\n]+\})/);
  return line ? JSON.parse(line[1]) : undefined;
}
