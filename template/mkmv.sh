#!/bin/bash
# ==============================================================================
# RPG Maker MV - PortMaster Official Universal Launcher Script
# Version: 0.3.0
# ==============================================================================

# ⭐ [설정] 기본 게임 폴더명 (폴더명을 바꾸셨다면 아래 이름을 일치시켜 주세요)
GAME_CODE="mkmv"

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

# Directory setup (게임 데이터 디렉토리 감지)
if [ -d "/$directory/ports/$GAME_CODE" ]; then
  GAME_ROOT="/$directory/ports/$GAME_CODE"
elif [ -d "$SCRIPT_DIR/$GAME_CODE" ]; then
  GAME_ROOT="$SCRIPT_DIR/$GAME_CODE"
elif [ -f "$SCRIPT_DIR/electron" ]; then
  GAME_ROOT="$SCRIPT_DIR"
else
  GAME_ROOT="$(pwd)"
fi
export GAME_ROOT

# Runtime setup (포터블 모드 vs 공유 런타임 모드 다단계 자동 감지)
RUNTIME_DIR=""
if [ -f "$GAME_ROOT/electron" ]; then
  # 1. 포터블 모드: 게임 디렉토리 자체에 electron이 존재하는 경우
  RUNTIME_DIR="$GAME_ROOT"
elif [ -f "$SCRIPT_DIR/mkmv-runtime/electron" ]; then
  # 2. 공유 런타임 모드: ports/mkmv-runtime
  RUNTIME_DIR="$SCRIPT_DIR/mkmv-runtime"
elif [ -f "/$directory/ports/mkmv-runtime/electron" ]; then
  RUNTIME_DIR="/$directory/ports/mkmv-runtime"
elif [ -f "$SCRIPT_DIR/mkmv/electron" ]; then
  # 3. 대체 폴더명 호환: ports/mkmv
  RUNTIME_DIR="$SCRIPT_DIR/mkmv"
elif [ -f "/$directory/ports/mkmv/electron" ]; then
  RUNTIME_DIR="/$directory/ports/mkmv"
elif [ -f "$controlfolder/libs/mkmv-runtime/electron" ]; then
  # 4. PortMaster 시스템 라이브러리 디렉토리
  RUNTIME_DIR="$controlfolder/libs/mkmv-runtime"
fi

if [ -z "$RUNTIME_DIR" ] || [ ! -f "$RUNTIME_DIR/electron" ]; then
  echo "================================================="
  echo "[mkmv ERROR] Runtime directory not found!"
  echo "Please make sure 'mkmv-runtime' exists in ports/ or ports/mkmv-runtime."
  echo "================================================="
  if [ -n "$controlfolder" ] && type pm_message >/dev/null 2>&1; then
    pm_message "Error: mkmv-runtime not found! Please place mkmv-runtime in ports/"
  fi
  exit 1
fi
export RUNTIME_DIR

if command -v mktemp >/dev/null 2>&1; then
  RUNNER="$(mktemp /tmp/mkmv_runner.XXXXXX.sh 2>/dev/null || echo "/tmp/mkmv_runner_${$}.sh")"
else
  RUNNER="/tmp/mkmv_runner_${$}.sh"
fi

SWAP_ACTIVE=0

cleanup() {
  echo "Cleaning up runtime environment..."
  # CPU 클럭 원상 복구
  if [ ${#ORIG_SCALING_FREQS[@]} -gt 0 ]; then
    echo "Restoring original CPU scaling frequencies..."
    for entry in "${ORIG_SCALING_FREQS[@]}"; do
      f_path="${entry%%:*}"
      f_val="${entry##*:}"
      if [ -w "$f_path" ] && [ -n "$f_val" ]; then
        echo "$f_val" > "$f_path" 2>/dev/null
      fi
    done
  fi
  # ZRAM 스왑 비활성화
  if [ "$SWAP_ACTIVE" -eq 1 ]; then
    echo "Disabling ZRAM swap buffer..."
    swapoff /dev/zram0 2>/dev/null
    echo 1 > /sys/block/zram0/reset 2>/dev/null
  fi
  echo "=== SYSTEM MEMORY STATUS ==="
  free -m 2>/dev/null
  echo "=== KERNEL DMESG (OOM / CRASH CHECK) ==="
  dmesg | tail -n 50 2>/dev/null
  rm -f "$RUNNER" 2>/dev/null
  if [ -d "/tmp/weston" ]; then
    /tmp/weston/westonwrap.sh cleanup 2>/dev/null
    $ESUDO umount /tmp/weston 2>/dev/null
  fi
  pm_finish
}
trap cleanup EXIT INT TERM

CONF_DIR="$GAME_ROOT/conf"
mkdir -p "$CONF_DIR"
mkdir -p "$GAME_ROOT/www/save" "$GAME_ROOT/game/save" "$GAME_ROOT/save"

# Enable logging (게임 디렉토리 내에 독립적으로 기록)
> "$GAME_ROOT/log.txt" && exec > >(tee "$GAME_ROOT/log.txt") 2>&1

echo "================================================="
echo "Starting $GAME_CODE on PortMaster ($CFW_NAME)"
echo "Game Directory: $GAME_ROOT"
echo "Runtime Directory: $RUNTIME_DIR"
echo "Date: $(date)"
echo "================================================="

# 시스템 미사용 캐시 정리 (최대 가용 RAM 확보)
sync
echo 3 > /proc/sys/vm/drop_caches 2>/dev/null
echo "=== INITIAL MEMORY STATUS ==="
free -m 2>/dev/null

# ZRAM 압축 스왑(512MB) 점검 및 활성화 (exFAT 파일시스템 한계 극복 및 OOM 원천 방어)
SWAP_ACTIVE=0
if [ -z "$(swapon -s 2>/dev/null | grep -v Filename)" ]; then
  echo "No active swap detected. Enabling ZRAM 512MB compressed swap..."
  modprobe zram num_devices=1 2>/dev/null
  if [ -e /sys/block/zram0/disksize ]; then
    swapoff /dev/zram0 2>/dev/null
    echo 1 > /sys/block/zram0/reset 2>/dev/null || true
    echo lz4 > /sys/block/zram0/comp_algorithm 2>/dev/null || true
    echo 536870912 > /sys/block/zram0/disksize 2>/dev/null
    mkswap /dev/zram0 >/dev/null 2>&1
    if swapon -p 32767 /dev/zram0 2>/dev/null; then
      echo "Successfully enabled 512MB ZRAM compressed swap buffer!"
      SWAP_ACTIVE=1
    fi
  fi
else
  echo "Existing swap buffer active:"
  swapon -s 2>/dev/null
fi
echo "=== ACTIVE MEMORY & SWAP STATUS ==="
free -m 2>/dev/null

# WebGL / SwiftShader 호환 라이브러리 보존
chmod +x "$RUNTIME_DIR"/*.so "$GAME_ROOT"/*.so 2>/dev/null

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
export PULSE_LATENCY_MSEC=60

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

chmod +x "$RUNTIME_DIR/electron" 2>/dev/null
chmod +x "$RUNTIME_DIR/gptokeyb" "$GAME_ROOT/gptokeyb" 2>/dev/null
chmod -R +r "$RUNTIME_DIR/lib" "$RUNTIME_DIR/conf" "$RUNTIME_DIR/share" 2>/dev/null
chmod -R +r "$GAME_ROOT/conf" "$GAME_ROOT/www" "$GAME_ROOT/game" 2>/dev/null

# GPTK 실행 및 프로세스 바인딩 (게임별 키맵 우선, 없으면 런타임 공용 기본 키맵)
if [ -f "$GAME_ROOT/keymap.gptk" ]; then
  GPTK_FILE="$GAME_ROOT/keymap.gptk"
else
  GPTK_FILE="$RUNTIME_DIR/keymap.gptk"
fi
echo "Using GPTK keymap: $GPTK_FILE"
$GPTOKEYB "electron" -c "$GPTK_FILE" -k "electron" &
pm_platform_helper "$RUNTIME_DIR/electron" >/dev/null

echo "=== DISPLAY & RUNTIME ENVIRONMENT ==="
echo "CFW_NAME: $CFW_NAME"
echo "DISPLAY: $DISPLAY"
echo "WAYLAND_DISPLAY: $WAYLAND_DISPLAY"
echo "XDG_RUNTIME_DIR: $XDG_RUNTIME_DIR"
echo "PULSE_SERVER: $PULSE_SERVER"

# 램디스크(/tmp)에 에뮬레이션스테이션에 노출되지 않는 임시 실행기 생성 (SD 카드 목록 오염 방지)
cat << 'RUNNER_EOF' > "$RUNNER"
#!/bin/bash
GAME_ROOT="${GAME_ROOT:-$(pwd)}"
RUNTIME_DIR="${RUNTIME_DIR:-$GAME_ROOT}"
cd "$GAME_ROOT"

# Crusty 등 외부 LD_PRELOAD 및 라이브러리 간섭 차단
unset LD_PRELOAD
export LD_PRELOAD=""

# glibc 메모리 단편화 및 과도한 아레나 풀 차단 (500MB -> 200MB대로 다이어트)
export MALLOC_ARENA_MAX=1
export MALLOC_TRIM_THRESHOLD_=65536
export MALLOC_MMAP_THRESHOLD_=65536

# Electron 전용 라이브러리 및 환경 설정 (외부 weston/crusty 경로를 완벽히 배제)
export LD_LIBRARY_PATH="$RUNTIME_DIR/lib:$RUNTIME_DIR:/usr/lib:/usr/lib/aarch64-linux-gnu:/lib:/lib/aarch64-linux-gnu"
export ELECTRON_ENABLE_LOGGING=1
export GTK_CSD=0
export PULSE_LATENCY_MSEC=60

# GDK Pixbuf 및 MIME 데이터베이스 설정
export GDK_PIXBUF_MODULEDIR="$RUNTIME_DIR/lib"
export GDK_PIXBUF_MODULE_FILE="$RUNTIME_DIR/conf/loaders.cache"
export XDG_DATA_DIRS="$RUNTIME_DIR/share:/usr/share:$XDG_DATA_DIRS"

export MKMV_RUNTIME_DIR="$RUNTIME_DIR"
export MKMV_GAME_DIR="$GAME_ROOT"

# GPU 및 메모리 정책은 main.js(modules/config.js)에서 mkmv.json 설정을 기반으로 동적 결정
# 공백이 포함된 경로가 깨지지 않도록 배열 형태로 인자 전달
FLAGS=(--ozone-platform=wayland
       --enable-features=UseOzonePlatform,NetworkServiceInProcess
       --disable-dev-shm-usage
       --no-sandbox
       --high-dpi-support=1
       --disable-features=TouchpadAndWheelScrollLatching
       --autoplay-policy=no-user-gesture-required
       "--user-data-dir=$GAME_ROOT/conf"
       "--game-dir=$GAME_ROOT")

chmod +x "$RUNTIME_DIR/electron" 2>/dev/null
echo "Launching Electron: $RUNTIME_DIR/electron $RUNTIME_DIR ${FLAGS[*]}"
exec "$RUNTIME_DIR/electron" "$RUNTIME_DIR" "${FLAGS[@]}"
RUNNER_EOF
chmod +x "$RUNNER" 2>/dev/null

# 발열 방지 클럭 상한선(Thermal Cap) 적용
# RK3576 빅코어(cpu4-7)가 2.2GHz 풀클럭으로 구동 시 패시브 쿨링 기기에서 패키지 온도가 83°C에 도달하여 전원 차단이 발생합니다.
# 2D 알만툴 구동에는 1.6GHz로도 60fps가 충분하므로 안전 상한선(1.6GHz)을 적용합니다.
ORIG_SCALING_FREQS=()
TARGET_MAX_FREQ="${MKMV_MAX_FREQ:-1608000}"

CONF_FILE="$GAME_ROOT/mkmv.json"
[ ! -f "$CONF_FILE" ] && CONF_FILE="$RUNTIME_DIR/mkmv.json"
if [ -f "$CONF_FILE" ]; then
  JSON_FREQ=$(grep -o '"cpuMaxFreq"[[:space:]]*:[[:space:]]*[0-9]*' "$CONF_FILE" 2>/dev/null | awk -F: '{print $2}' | tr -d ' ')
  if [ -n "$JSON_FREQ" ] && [ "$JSON_FREQ" -gt 0 ]; then
    TARGET_MAX_FREQ="$JSON_FREQ"
  fi
fi

if [ -w /sys/devices/system/cpu/cpu4/cpufreq/scaling_max_freq ]; then
  for f in /sys/devices/system/cpu/cpu[4-7]/cpufreq/scaling_max_freq; do
    if [ -f "$f" ]; then
      cur_max=$(cat "$f" 2>/dev/null)
      if [ -n "$cur_max" ] && [ "$cur_max" -gt "$TARGET_MAX_FREQ" ]; then
        ORIG_SCALING_FREQS+=("$f:$cur_max")
        echo "$TARGET_MAX_FREQ" > "$f" 2>/dev/null
        echo "[mkmv] Thermal safety: capped $(basename "$(dirname "$(dirname "$f")")") to ${TARGET_MAX_FREQ}kHz (was ${cur_max}kHz)"
      fi
    fi
  done
fi

# CPU 코어 스케줄링 정책:
# 무소음/패시브 쿨링 기기(RG Vita Pro 등)는 빅코어에만 프로세스를 강제 바인딩(taskset -c 4-7)할 경우
# 4개 빅코어에 발열이 집중되어 급격한 온도 상승(83°C 임계치 초과)으로 인한 비상 재부팅이 발생합니다.
# 기본적으로 리눅스 CFS 스케줄러가 8개 코어 전체에 부하를 유연하게 분산하도록 허용하며,
# 사용자가 명시적으로 ENABLE_FAST_CORES=1을 설정한 경우에만 빅코어 바인딩을 적용합니다.
LAUNCH_CMD=("$RUNNER")
if [ "$ENABLE_FAST_CORES" = "1" ] && [ -n "$FAST_CORES" ]; then
  echo "High performance CPU cores explicitly requested ($FAST_CORES), binding affinity..."
  LAUNCH_CMD=($FAST_CORES "$RUNNER")
else
  echo "Balanced multi-core scheduling active (CFS all-cores distribution)."
fi

# Wayland 환경 여부에 따른 실행 분기
if [ -n "$WAYLAND_DISPLAY" ]; then
  echo "Active Wayland session detected. Launching directly..."
  "${LAUNCH_CMD[@]}"
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

# 정상 종료 시 trap cleanup EXIT가 자동 호출됩니다.
exit 0
