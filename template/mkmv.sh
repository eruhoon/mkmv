#!/bin/bash
# ==============================================================================
# RPG Maker MV - PortMaster Official Universal Launcher Script
# Version: 0.1.0
# ==============================================================================

# ⭐ [설정] 기본 게임 폴더명 (폴더명을 바꾸셨다면 아래 이름을 일치시켜 주세요)
GAME_CODE="ST3739190"

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}" .sh)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODE_PREFIX="${SCRIPT_NAME%% - *}"

# 1. 게임 폴더명 자동 감지 (공백 및 " - 부제" 포함 런처 파일명 완벽 지원)
if [ -d "/$directory/ports/$SCRIPT_NAME" ]; then
  GAME_CODE="$SCRIPT_NAME"
elif [ -d "$SCRIPT_DIR/$SCRIPT_NAME" ]; then
  GAME_CODE="$SCRIPT_NAME"
elif [ -d "/$directory/ports/$CODE_PREFIX" ]; then
  GAME_CODE="$CODE_PREFIX"
elif [ -d "$SCRIPT_DIR/$CODE_PREFIX" ]; then
  GAME_CODE="$CODE_PREFIX"
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

# Directory setup (루트 또는 서브폴더 위치 자동 적응)
if [ -f "$SCRIPT_DIR/electron" ]; then
  GAME_ROOT="$SCRIPT_DIR"
elif [ -d "/$directory/ports/$GAME_CODE" ]; then
  GAME_ROOT="/$directory/ports/$GAME_CODE"
elif [ -d "$SCRIPT_DIR/$GAME_CODE" ]; then
  GAME_ROOT="$SCRIPT_DIR/$GAME_CODE"
else
  GAME_ROOT="$(pwd)"
fi
export GAME_ROOT

CONF_DIR="$GAME_ROOT/conf"
mkdir -p "$CONF_DIR"
mkdir -p "$GAME_ROOT/www/save"

# Enable logging
> "$GAME_ROOT/log.txt" && exec > >(tee "$GAME_ROOT/log.txt") 2>&1

echo "================================================="
echo "Starting $GAME_CODE on PortMaster ($CFW_NAME)"
echo "Directory: $GAME_ROOT"
echo "Date: $(date)"
echo "================================================="

# 충돌 번들 라이브러리 정리
rm -f "$GAME_ROOT/libEGL.so" "$GAME_ROOT/libGLESv2.so" "$GAME_ROOT/libvk_swiftshader.so" "$GAME_ROOT/libvulkan.so.1" 2>/dev/null

# Wayland 소켓 파일 동적 탐색 (ROCKNIX 등 이미 켜진 Wayland 감지)
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

# PulseAudio / PipeWire 사운드 소켓 동적 탐색 (KNULLI & ROCKNIX 공통)
unset PULSE_SERVER
for s in "$XDG_RUNTIME_DIR/pulse/native" "/run/user/0/pulse/native" "/run/user/1000/pulse/native" "/var/run/pulse/native" "/tmp/pulse-socket"; do
  if [ -S "$s" ]; then
    export PULSE_SERVER="unix:$s"
    echo "Found active audio socket: $s"
    break
  fi
done

# Exports (런처 단계에서는 시스템 라이브러리만 유지하여 westonwrap 오작동 방지)
export PORTMASTER_HOME="$controlfolder"
export SDL_GAMECONTROLLERCONFIG="$sdl_controllerconfig"
export TEXTINPUTINTERACTIVE="Y"
export XDG_DATA_HOME="$CONF_DIR"
export ELECTRON_ENABLE_LOGGING=1
export LD_LIBRARY_PATH="/usr/lib:/usr/lib/aarch64-linux-gnu:$LD_LIBRARY_PATH"
unset DBUS_SESSION_BUS_ADDRESS
export LC_ALL=C
export LANG=C

cd "$GAME_ROOT"

chmod +x "$GAME_ROOT/electron" 2>/dev/null
chmod +x "$GAME_ROOT/gptokeyb" 2>/dev/null
chmod -R +r "$GAME_ROOT/lib" "$GAME_ROOT/conf" "$GAME_ROOT/share" 2>/dev/null

# GPTK 실행 및 프로세스 바인딩 (SELECT + START 강제 종료 지원)
$GPTOKEYB "electron" -c "./keymap.gptk" -k "electron" &
pm_platform_helper "$GAME_ROOT/electron" >/dev/null

echo "=== DISPLAY & RUNTIME ENVIRONMENT ==="
echo "CFW_NAME: $CFW_NAME"
echo "DISPLAY: $DISPLAY"
echo "WAYLAND_DISPLAY: $WAYLAND_DISPLAY"
echo "XDG_RUNTIME_DIR: $XDG_RUNTIME_DIR"
echo "PULSE_SERVER: $PULSE_SERVER"

# 램디스크(/tmp)에 에뮬레이션스테이션에 노출되지 않는 고정 임시 실행기 생성 (SD 카드 목록 오염 방지)
RUNNER="/tmp/mkmv_runner.sh"
cat << 'RUNNER_EOF' > "$RUNNER"
#!/bin/bash
GAME_ROOT="${GAME_ROOT:-/userdata/roms/ports/mkmv}"
cd "$GAME_ROOT"

# Crusty 등 외부 LD_PRELOAD 및 라이브러리 간섭 차단
unset LD_PRELOAD
export LD_PRELOAD=""

# Electron 전용 라이브러리 및 환경 설정 (외부 weston/crusty 경로를 완벽히 배제)
export LD_LIBRARY_PATH="$GAME_ROOT/lib:$GAME_ROOT:/usr/lib:/usr/lib/aarch64-linux-gnu:/lib:/lib/aarch64-linux-gnu"
export ELECTRON_ENABLE_LOGGING=1
export GTK_CSD=0

# GDK Pixbuf 및 MIME 데이터베이스 설정
export GDK_PIXBUF_MODULEDIR="$GAME_ROOT/lib"
export GDK_PIXBUF_MODULE_FILE="$GAME_ROOT/conf/loaders.cache"
export XDG_DATA_DIRS="$GAME_ROOT/share:/usr/share:$XDG_DATA_DIRS"

FLAGS="--ozone-platform=wayland \
       --enable-features=UseOzonePlatform \
       --disable-gpu \
       --disable-gpu-compositing \
       --disable-gpu-watchdog \
       --disable-dev-shm-usage \
       --no-sandbox \
       --high-dpi-support=1 \
       --disable-features=TouchpadAndWheelScrollLatching \
       --autoplay-policy=no-user-gesture-required"

chmod +x "$GAME_ROOT/electron" 2>/dev/null
echo "Launching Electron: $GAME_ROOT/electron . $FLAGS"
exec "$GAME_ROOT/electron" . $FLAGS
RUNNER_EOF
chmod +x "$RUNNER" 2>/dev/null

# Wayland 환경 여부에 따른 실행 분기
if [ -n "$WAYLAND_DISPLAY" ]; then
  echo "Active Wayland session detected. Launching directly..."
  "$RUNNER"
else
  # 커널 하드웨어 DRM 노드가 없는 기기(Allwinner H700 BSP 등)를 위한 가상 DRM 노드 보장
  $ESUDO mkdir -p /dev/dri
  if [ ! -e /dev/dri/card0 ]; then
    $ESUDO mknod /dev/dri/card0 c 226 0
    $ESUDO chmod 666 /dev/dri/card0
  fi

  weston_dir=/tmp/weston
  weston_runtime="weston_pkg_0.2"
  if [ -f "$controlfolder/libs/${weston_runtime}.squashfs" ]; then
    echo "Found Weston runtime at $controlfolder/libs/${weston_runtime}.squashfs"
    $ESUDO mkdir -p "${weston_dir}"
    $ESUDO umount "${weston_dir}" 2>/dev/null
    $ESUDO mount "$controlfolder/libs/${weston_runtime}.squashfs" "${weston_dir}"
  fi

  if [ -f "${weston_dir}/westonwrap.sh" ]; then
    echo "Launching via Weston (DRM Auto Kiosk Crusty mode)..."
    export CRUSTY_RESOLUTION="${DISPLAY_WIDTH:-640}x${DISPLAY_HEIGHT:-480}"
    $weston_dir/westonwrap.sh drm auto kiosk crusty_gbm "$RUNNER"
    $weston_dir/westonwrap.sh cleanup 2>/dev/null
    $ESUDO umount "${weston_dir}" 2>/dev/null
  else
    echo "Weston not found, attempting direct launch..."
    "$RUNNER"
  fi
fi

# Cleanup
rm -f "$RUNNER" 2>/dev/null
pm_finish
