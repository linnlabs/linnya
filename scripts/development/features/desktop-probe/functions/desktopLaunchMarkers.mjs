export function readDesktopCdpPort(output) {
  const line = output?.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\//);
  return line ? Number(line[1]) : undefined;
}

/** Node 把 Main 调试口写到 stderr；重启会重写日志，所以读到的总是本次启动的地址。 */
export function readDesktopMainInspector(output) {
  return output?.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[\w-]+)/)?.[1];
}

export function readDesktopReady(output) {
  const line = output?.match(/\[Desktop\] ready (\{[^\n]+\})/);
  return line ? JSON.parse(line[1]) : undefined;
}
