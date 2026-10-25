#!/bin/bash
# build-appimage.sh — сборка AppImage для Plotter Controller (x86_64)
# Требуется: curl (+ xz для авто-установки Node.js). Если node/npm не установлены —
# скрипт сам скачает portable-Node в appimage/.tools и использует его.
set -euo pipefail

cd "$(dirname "$0")/.."   # корень проекта plotter-controller
ROOT="$PWD"
AI="$ROOT/appimage"
APPDIR="$AI/AppDir"

NODE_VERSION="${NODE_VERSION:-20.18.1}"

# --- Поиск или авто-установка Node.js ---------------------------------------
find_node() {
  command -v node 2>/dev/null || true
}

NODE_BIN="$(find_node)"
if [ -n "$NODE_BIN" ]; then
  NODE_MAJOR="$(basename "$NODE_BIN" | sed 's/^v//; s/\..*//')"
  if [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
    echo "[!] Найден слишком старый node ($($NODE_BIN --version)), требуется >= 18. Скачиваю portable..."
    NODE_BIN=""
  fi
fi

if [ -z "$NODE_BIN" ]; then
  TOOLS="$AI/.tools/node-v${NODE_VERSION}-linux-x64"
  if [ ! -x "$TOOLS/bin/node" ]; then
    echo "[..] Node.js не найден в PATH — скачиваю portable Node v${NODE_VERSION}..."
    mkdir -p "$AI/.tools"
    curl -sL -o "$AI/.tools/node.tar.xz" \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
    tar xf "$AI/.tools/node.tar.xz" -C "$AI/.tools"
    rm -f "$AI/.tools/node.tar.xz"
  fi
  export PATH="$TOOLS/bin:$PATH"
  NODE_BIN="$TOOLS/bin/node"
  echo "[..] Использую node: $($NODE_BIN --version) из $TOOLS"
fi

APP_VERSION="$("$NODE_BIN" -p "require('./package.json').version")"

echo "[1/5] Сборка фронтенда (vite build)..."
npm run build

echo "[2/5] Подготовка AppDir..."
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/lib/app" "$APPDIR/usr/share/icons"

# Встроенный рантайм Node.js (берём из кэша или из portable-установки .tools)
RUNTIME_TARBALL="$AI/node-v${NODE_VERSION}-linux-x64.tar.xz"
PORTABLE_NODE="$AI/.tools/node-v${NODE_VERSION}-linux-x64/bin/node"
if [ -f "$RUNTIME_TARBALL" ]; then
  tar xf "$RUNTIME_TARBALL" -C "$AI" "node-v${NODE_VERSION}-linux-x64/bin/node"
  mv "$AI/node-v${NODE_VERSION}-linux-x64/bin/node" "$APPDIR/usr/bin/node"
  rm -rf "$AI/node-v${NODE_VERSION}-linux-x64"
elif [ -x "$PORTABLE_NODE" ]; then
  cp "$PORTABLE_NODE" "$APPDIR/usr/bin/node"
else
  echo "[..] Скачивание Node.js v${NODE_VERSION}..."
  curl -sL -o "$RUNTIME_TARBALL" \
    "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
  tar xf "$RUNTIME_TARBALL" -C "$AI" "node-v${NODE_VERSION}-linux-x64/bin/node"
  mv "$AI/node-v${NODE_VERSION}-linux-x64/bin/node" "$APPDIR/usr/bin/node"
  rm -rf "$AI/node-v${NODE_VERSION}-linux-x64"
fi
chmod +x "$APPDIR/usr/bin/node"

# Продакшн-зависимости в отдельную папку
echo "[3/5] Установка production-зависимостей..."
rm -rf "$AI/appstage"
mkdir -p "$AI/appstage"
cat > "$AI/appstage/package.json" <<EOF
{
  "name": "plotter-controller-app",
  "version": "${APP_VERSION}",
  "private": true,
  "type": "module",
  "dependencies": $("$NODE_BIN" -p "JSON.stringify(require('$ROOT/package.json').dependencies)")
}
EOF
(cd "$AI/appstage" && npm install --omit=dev --no-audit --no-fund)
# Оставляем только prebuilds для linux-x64
rm -rf "$AI/appstage/node_modules/@serialport/bindings-cpp/prebuilds/"{win32*,darwin*,android*,linux-arm*}
cp -r "$AI/appstage/node_modules" "$APPDIR/usr/lib/app/node_modules"

# Код приложения
cp -r "$ROOT/server" "$ROOT/dist" "$ROOT/public" "$ROOT/package.json" "$APPDIR/usr/lib/app/"
cp "$AI/shutdown-helper.js" "$APPDIR/usr/lib/app/"

# Файлы AppImage-спецификации
cp "$AI/AppRun.template" "$APPDIR/AppRun"
chmod +x "$APPDIR/AppRun"
cp "$AI/plotter-controller.desktop" "$APPDIR/"
cp "$AI/plotter-controller.png" "$APPDIR/"
cp "$AI/plotter-controller.svg" "$APPDIR/"
cp "$AI/plotter-controller.svg" "$APPDIR/usr/share/icons/"

echo "[4/5] Упаковка в AppImage..."
TOOL="$AI/squashfs-root/usr/bin/appimagetool"
if [ ! -x "$TOOL" ]; then
  echo "[..] Скачивание appimagetool..."
  curl -sL -o "$AI/appimagetool.bin" \
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"
  chmod +x "$AI/appimagetool.bin"
  (cd "$AI" && ./appimagetool.bin --appimage-extract >/dev/null 2>&1 || true)
fi

# appimagetool требует утилиты `file` — если её нет, скачиваем portable-версию
if ! command -v file >/dev/null 2>&1; then
  LIBMAGIC_DIR="$AI/.tools/libmagic"
  if [ ! -x "$LIBMAGIC_DIR/file" ]; then
    echo "[..] Утилита 'file' не найдена — скачиваю portable libmagic..."
    mkdir -p "$LIBMAGIC_DIR"
    (cd "$LIBMAGIC_DIR" \
      && curl -sL -o libmagic.tar.xz "https://github.com/file/file.git" 2>/dev/null; true)
    # берём готовый статический бинарник из проекта sbuild/static-file
    curl -sL -o "$LIBMAGIC_DIR/file.gz" \
      "https://github.com/sbuild/static-file/raw/main/file" || true
    if [ -s "$LIBMAGIC_DIR/file.gz" ]; then
      gunzip -f "$LIBMAGIC_DIR/file.gz" 2>/dev/null || mv "$LIBMAGIC_DIR/file.gz" "$LIBMAGIC_DIR/file"
      chmod +x "$LIBMAGIC_DIR/file"
    fi
  fi
  if [ -x "$LIBMAGIC_DIR/file" ]; then
    mkdir -p "$AI/.tools/bin"
    cp "$LIBMAGIC_DIR/file" "$AI/.tools/bin/file" 2>/dev/null || true
    export PATH="$AI/.tools/bin:$PATH"
    echo "[..] Использую portable file: $(command -v file)"
  else
    echo "[!] Не удалось получить утилиту 'file'. Установите её:"
    echo "    sudo apt install file   (Debian/Ubuntu)  или  sudo dnf install file (Fedora)"
    exit 1
  fi
fi

(cd "$AI" && ARCH=x86_64 VERSION="$APP_VERSION" "$TOOL" AppDir)

OUT="$(ls "$AI"/Plotter_Controller-*-x86_64.AppImage 2>/dev/null | head -1 || true)"
echo "[5/5] Готово!"
[ -n "$OUT" ] && ls -la "$OUT"
