#!/bin/sh

set -eu

run_root=$1
run_token=$2
role=$3

case "$run_root" in
  *[!A-Za-z0-9_-]*|'')
    printf 'invalid relative evidence directory\n' >&2
    exit 64
    ;;
esac

case "$run_token" in
  *[!A-Za-z0-9_-]*|'')
    printf 'invalid run token\n' >&2
    exit 64
    ;;
esac

case "$role" in
  parent|child|grandchild) ;;
  *)
    printf 'invalid process role\n' >&2
    exit 64
    ;;
esac

publish_identity() {
  identity_path="$run_root/$role.json"
  pending_path="$identity_path.$$.pending"
  printf '{"version":1,"runToken":"%s","role":"%s","pid":%s,"parentPid":%s}\n' \
    "$run_token" "$role" "$$" "$PPID" > "$pending_path"
  mv "$pending_path" "$identity_path"
}

start_descendant() {
  descendant_role=$1
  /bin/sh "$0" "$run_root" "$run_token" "$descendant_role" &
}

case "$role" in
  parent) start_descendant child ;;
  child) start_descendant grandchild ;;
esac

publish_identity
trap 'exit 0' HUP INT TERM

sequence=0
heartbeat_path="$run_root/$role.heartbeat.log"
if [ "$role" = parent ]; then
  printf 'production-agent-parent-start\n'
fi
while :; do
  sequence=$((sequence + 1))
  timestamp=$(date +%s)
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$run_token" "$role" "$$" "$sequence" "$timestamp" >> "$heartbeat_path"
  if [ "$role" = parent ] && [ "$sequence" -eq 10 ]; then
    printf 'production-agent-parent-tick-%s\n' "$sequence"
    printf 'interaction-request: enter value >\n'
    if IFS= read -r interaction_value; then
      printf 'interaction-stdin:received\n'
    else
      printf 'interaction-stdin:eof\n'
    fi
  fi
  sleep 0.05
done
