#!/bin/bash
# AI 照相馆 · 一键启动器（自动清理端口 + 重启）
# 双击本文件即可：清理旧进程 → 检查 MySQL → 启动服务 → 打开浏览器
cd "$(dirname "$0")" || exit 1

echo "=============================="
echo "  AI 照相馆 · 启动中"
echo "=============================="

# 0. 清理占用 4177 端口的旧进程（保证重启拿到最新代码）
PIDS=$(lsof -ti:4177 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "[0/3] 发现旧服务进程 (PID: $PIDS)，正在停止..."
  kill -9 $PIDS 2>/dev/null
  sleep 1
  echo "      旧进程已清理 ✓"
else
  echo "[0/3] 端口 4177 空闲 ✓"
fi

# 1. 检查 MySQL 是否在运行（3306 端口）
if ! nc -z 127.0.0.1 3306 2>/dev/null; then
  echo "[1/3] MySQL 未运行，尝试通过 Homebrew 启动..."
  if command -v brew >/dev/null 2>&1; then
    brew services start mysql 2>/dev/null || brew services start mysql@8.0 2>/dev/null
    for i in $(seq 1 15); do
      nc -z 127.0.0.1 3306 2>/dev/null && break
      sleep 1
    done
  fi
  if ! nc -z 127.0.0.1 3306 2>/dev/null; then
    echo ""
    echo "⚠️  没能自动启动 MySQL，请先手动启动 MySQL 后再双击本文件。"
    echo "   （常见方式：brew services start mysql，或打开 MySQL 偏好设置面板）"
    echo ""
    read -r -p "按回车键退出..."
    exit 1
  fi
  echo "      MySQL 已就绪 ✓"
else
  echo "[1/3] MySQL 已在运行 ✓"
fi

# 2. 安装/更新依赖（已是最新时秒过）
echo "[2/4] 检查依赖..."
npm install --no-audit --no-fund --loglevel=error || echo "      依赖安装失败（不影响已有功能，二维码图片可能无法显示）"

# 3. 延迟 2 秒后自动打开浏览器
echo "[3/4] 2 秒后自动打开 http://localhost:4177 ..."
(sleep 2 && open "http://localhost:4177") &

# 4. 启动服务（保持本窗口开着；关掉窗口即停止服务）
echo "[4/4] 启动 Node 服务（关闭本窗口即可停止服务）"
echo "------------------------------"
npm run dev
