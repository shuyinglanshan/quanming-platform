#!/usr/bin/env bash
# 便捷启停脚本：./scripts/dev-server.sh start|stop|restart|status
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="$ROOT/.server.pid"
LOGFILE="$ROOT/.server.log"

is_running() {
  [[ -f "$PIDFILE" ]] || return 1
  local pid
  pid="$(cat "$PIDFILE")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

start() {
  if is_running; then
    echo "服务已在运行 (pid $(cat "$PIDFILE"))"
    return 0
  fi
  cd "$ROOT/server" || exit 1
  nohup node index.js >"$LOGFILE" 2>&1 &
  echo $! >"$PIDFILE"
  sleep 1.5
  if is_running; then
    echo "服务已启动 (pid $(cat "$PIDFILE"))，日志: $LOGFILE"
    tail -n 8 "$LOGFILE"
  else
    echo "启动失败，日志如下："
    cat "$LOGFILE"
    return 1
  fi
}

stop() {
  if is_running; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    sleep 0.6
    is_running && kill -9 "$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
    echo "服务已停止"
  else
    echo "服务未在运行"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) is_running && echo "running (pid $(cat "$PIDFILE"))" || echo "stopped" ;;
  log) tail -n 60 "$LOGFILE" ;;
  *) echo "用法: $0 {start|stop|restart|status|log}" ;;
esac
