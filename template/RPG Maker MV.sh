#!/bin/bash
# ==============================================================================
# RPG Maker MV - PortMaster Official Universal Launcher Script
# ==============================================================================

# ⭐ [설정] 기본 게임 폴더명 (폴더명을 바꾸셨다면 아래 이름을 일치시켜 주세요)
GAME_CODE="rpgmakermv"

# 만약 .sh 파일명과 동일한 이름의 폴더가 존재하면 자동으로 해당 폴더로 자동 매칭
SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}" .sh)"
if [ -d "/$directory/ports/$SCRIPT_NAME" ] || [ -d "./$SCRIPT_NAME" ]; then
  GAME_CODE="$SCRIPT_NAME"
fi

XDG_DATA_HOME=${XDG_DATA_HOME:-$HOME/.local/share}

# PortMaster header
if [ -d "/opt/system/Tools/PortMaster/" ]; then
  controlfolder="/opt/system/Tools/PortMaster"
elif [ -d "/opt/tools/PortMaster/" ]; then
  controlfolder="/opt/tools/PortMaster"
elif [ -d "$XDG_DATA_HOME/PortMaster/" ]; then
  controlfolder="$XDG_DATA_HOME/PortMaster"
else
  controlfolder="/roms/ports/PortMaster"
fi

source $controlfolder/control.txt
[ -f "${controlfolder}/mod_${CFW_NAME}.txt" ] && source "${controlfolder}/mod_${CFW_NAME}.txt"
get_controls

# Directory setup
GAME_ROOT=/$directory/ports/$GAME_CODE
[ ! -d "$GAME_ROOT" ] && GAME_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/$GAME_CODE" && pwd)"
[ ! -d "$GAME_ROOT" ] && GAME_ROOT="$(pwd)"

CONF_DIR="$GAME_ROOT/conf"
mkdir -p "$CONF_DIR"

# Enable logging
> "$GAME_ROOT/log.txt" && exec > >(tee "$GAME_ROOT/log.txt") 2>&1

echo "================================================="
echo "Starting $GAME_CODE on PortMaster / ROCKNIX"
echo "Directory: $GAME_ROOT"
echo "Date: $(date)"
echo "================================================="

# 충돌 번들 라이브러리 정리
rm -f "$GAME_ROOT/libEGL.so" "$GAME_ROOT/libGLESv2.so" "$GAME_ROOT/libvk_swiftshader.so" "$GAME_ROOT/libvulkan.so.1" 2>/dev/null

# Wayland 소켓 파일 탐색
for d in "$XDG_RUNTIME_DIR" "/run/user/0" "/var/run/0-runtime-dir" "/run/user/1000" "/var/run" "/tmp" "/run"; do
  if [ -n "$d" ] && [ -d "$d" ]; then
    for s in "$d"/wayland-*; do
      if [ -S "$s" ]; then
        export XDG_RUNTIME_DIR="$d"
        export WAYLAND_DISPLAY="$(basename "$s")"
        echo "Found active Wayland display: $s"
        break 2
      fi
    done
  fi
done

# Exports
export SDL_GAMECONTROLLERCONFIG="$sdl_controllerconfig"
export TEXTINPUTINTERACTIVE="Y"
export XDG_DATA_HOME="$CONF_DIR"
export PULSE_SERVER=${PULSE_SERVER:-/tmp/pulse-socket}
export ELECTRON_ENABLE_LOGGING=1
export LD_LIBRARY_PATH="/usr/lib:/usr/lib/aarch64-linux-gnu:$GAME_ROOT/lib:$GAME_ROOT:$LD_LIBRARY_PATH"
unset DBUS_SESSION_BUS_ADDRESS
export LC_ALL=C
export LANG=C

cd "$GAME_ROOT"

chmod +x "$GAME_ROOT/electron" 2>/dev/null
chmod +x "$GAME_ROOT/gptokeyb" 2>/dev/null

# GPTK 실행 및 프로세스 바인딩 (SELECT + START 강제 종료 지원)
$GPTOKEYB "electron" -c "./rpgmakermv.gptk" &
pm_platform_helper "$GAME_ROOT/electron" >/dev/null

FLAGS="--ozone-platform=wayland \
       --enable-features=UseOzonePlatform \
       --disable-gpu \
       --disable-gpu-compositing \
       --disable-dev-shm-usage \
       --no-sandbox \
       --high-dpi-support=1 \
       --disable-features=TouchpadAndWheelScrollLatching \
       --autoplay-policy=no-user-gesture-required"

echo "Launching: ./electron . $FLAGS"
./electron . $FLAGS

# Cleanup
pm_finish
