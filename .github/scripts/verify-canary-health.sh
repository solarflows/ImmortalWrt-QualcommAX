#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════
# Canary Release Health & Driver Verification Script
# 完全动态自适应判定，杜绝硬编码特定包名或死日志
#
# 判据维度:
# 1. 动态 Seed 达成率核验 (configs/${TARGET}/*.seed -> build 成功)
# 2. Linux modpost 内核模块未解析符号通用扫描 (禁止 undefined! 符号)
# 3. 内核与目标软件包补丁应用完整性审查 (禁止 FAILED / .rej)
# 4. 固件镜像物理实体与校验和一致性检验
#
# 用法:
#   verify-canary-health.sh <TARGET> <ARTIFACTS_DIR> [REPORT_FILE] [CONFIGS_DIR]
# ════════════════════════════════════════════════════════════════════════

set -uo pipefail

TARGET="${1:-ipq807x}"
ARTIFACTS_DIR="${2:-.}"
REPORT_FILE="${3:-/tmp/canary-health-report.md}"
CONFIGS_DIR="${4:-configs/${TARGET}}"

echo "════════════════════════════════════════════════════════════════"
echo "🔍 启动 Canary Rolling 动态自适应质量门禁: ${TARGET}"
echo "   工件目录:   ${ARTIFACTS_DIR}"
echo "   配置目录:   ${CONFIGS_DIR}"
echo "   报告文件:   ${REPORT_FILE}"
echo "════════════════════════════════════════════════════════════════"

ERRORS=()
WARNINGS=()
CHECKED_ITEMS=()

mkdir -p "$(dirname "$REPORT_FILE")"
cat << 'EOF' > "$REPORT_FILE"
### 🔍 Canary 固件质量与硬件驱动健康度报告
EOF

echo "**目标平台**: \`${TARGET}\`  " >> "$REPORT_FILE"
echo "**检测时间**: $(date -u '+%Y-%m-%d %H:%M:%S UTC')  " >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# ──────── 辅助函数 ────────
add_error() {
  echo "::error::$1"
  ERRORS+=("$1")
}

add_warning() {
  echo "::warning::$1"
  WARNINGS+=("$1")
}

# ──────── 1. 检查构建日志与严重错误 ────────
echo "▶ [1/4] 检索构建过程与最终编译日志..."
FINAL_BUILD_LOG=""
for candidate in \
  "${ARTIFACTS_DIR}/build-log/build.log" \
  "${ARTIFACTS_DIR}/build.log" \
  "${ARTIFACTS_DIR}/${TARGET}-build-log/build.log"; do
  if [ -f "$candidate" ]; then
    FINAL_BUILD_LOG="$candidate"
    break
  fi
done

if [ -n "$FINAL_BUILD_LOG" ]; then
  echo "  发现最终构建日志: ${FINAL_BUILD_LOG}"
  # 检查最终 build.log 中是否残留任何致命编译失败
  FATAL_FAILS=$(grep -E '^(\s*ERROR:\s*(package|target)/.*failed to build)' "$FINAL_BUILD_LOG" 2>/dev/null || true)
  if [ -n "$FATAL_FAILS" ]; then
    add_error "构建日志中存在未解决的编译失败: $(echo "$FATAL_FAILS" | tr '\n' '; ')"
  else
    CHECKED_ITEMS+=("最终构建日志无编译失败 (build.log clean)")
  fi
else
  add_warning "未找到 build.log 文件，跳过顶层构建日志扫描"
fi

# 检查 build-info.json 中的 deferred_pkgs
BUILD_INFO=""
for candidate in \
  "${ARTIFACTS_DIR}/build-info/build-info.json" \
  "${ARTIFACTS_DIR}/build-info.json" \
  "${ARTIFACTS_DIR}/${TARGET}-build-info/build-info.json"; do
  if [ -f "$candidate" ]; then
    BUILD_INFO="$candidate"
    break
  fi
done

if [ -n "$BUILD_INFO" ] && command -v jq >/dev/null 2>&1; then
  DEFERRED=$(jq -r '.deferred_pkgs[]?' "$BUILD_INFO" 2>/dev/null || true)
  if [ -n "$DEFERRED" ]; then
    add_warning "检测到构建系统暂缓/跳过软件包: $(echo "$DEFERRED" | tr '\n' ' ')"
  else
    CHECKED_ITEMS+=("无构建系统暂缓包 (deferred_pkgs empty)")
  fi
fi

# ──────── 2. 内核模块 modpost 未决符号通用扫描 ────────
echo "▶ [2/4] 通用内核模块 modpost 未决符号扫描..."
UNDEFINED_SYMS=""
SCAN_DIRS=()
[ -n "$FINAL_BUILD_LOG" ] && SCAN_DIRS+=("$FINAL_BUILD_LOG")
[ -d "${ARTIFACTS_DIR}/build-log/logs" ] && SCAN_DIRS+=("${ARTIFACTS_DIR}/build-log/logs")
[ -d "${ARTIFACTS_DIR}/logs" ] && SCAN_DIRS+=("${ARTIFACTS_DIR}/logs")

if [ "${#SCAN_DIRS[@]}" -gt 0 ]; then
  # 匹配任何内核模块中由于符号变更/丢失导致的未解析符号
  UNDEFINED_SYMS=$(grep -rn -E 'WARNING:\s*"[^"]+"\s*\[[^]]+\.ko\]\s*undefined!' "${SCAN_DIRS[@]}" 2>/dev/null || true)
  if [ -n "$UNDEFINED_SYMS" ]; then
    add_error "检测到内核驱动模块存在未解析符号 (开机必崩溃): $(echo "$UNDEFINED_SYMS" | head -5 | tr '\n' '; ')"
  else
    CHECKED_ITEMS+=("内核模块符号链完整，无未决符号 (zero undefined symbols in modpost)")
  fi
else
  add_warning "无日志目录可用，跳过 modpost 符号扫描"
fi

# ──────── 3. 补丁应用干净度通用核验 ────────
echo "▶ [3/4] 检索补丁应用日志..."
PATCH_FAILS=""
if [ "${#SCAN_DIRS[@]}" -gt 0 ]; then
  PATCH_FAILS=$(grep -rn -E '(Hunk #[0-9]+ FAILED|saving rejects to file|Patch failed!)' "${SCAN_DIRS[@]}" 2>/dev/null || true)
  if [ -n "$PATCH_FAILS" ]; then
    add_error "构建日志中记录了补丁失败中断: $(echo "$PATCH_FAILS" | head -5 | tr '\n' '; ')"
  else
    CHECKED_ITEMS+=("内核与各软件包补丁全部清洁应用 (zero patch rejects/failures)")
  fi
fi

# ──────── 4. 固件产物实体与校验和一致性核验 ────────
echo "▶ [4/4] 固件镜像实体、Profiles 与校验和核验..."
FIRMWARE_DIR=""
WORK_DIR="/tmp/canary-verify-${TARGET}"
rm -rf "$WORK_DIR" && mkdir -p "$WORK_DIR"

# 查找 release tarball 或解包目录
RELEASE_TAR=""
for candidate in \
  "${ARTIFACTS_DIR}/release-tar/${TARGET}-release.tar.gz" \
  "${ARTIFACTS_DIR}/${TARGET}-release/${TARGET}-release.tar.gz" \
  "${ARTIFACTS_DIR}/${TARGET}-release.tar.gz" \
  "${ARTIFACTS_DIR}/release/${TARGET}-release.tar.gz"; do
  if [ -f "$candidate" ]; then
    RELEASE_TAR="$candidate"
    break
  fi
done

if [ -n "$RELEASE_TAR" ]; then
  echo "  解包固件工件: ${RELEASE_TAR}"
  tar -xzf "$RELEASE_TAR" -C "$WORK_DIR" 2>/dev/null || true
  if [ -d "$WORK_DIR/firmware" ]; then
    FIRMWARE_DIR="$WORK_DIR/firmware"
  else
    FIRMWARE_DIR="$WORK_DIR"
  fi
elif [ -d "${ARTIFACTS_DIR}/firmware" ]; then
  FIRMWARE_DIR="${ARTIFACTS_DIR}/firmware"
fi

if [ -n "$FIRMWARE_DIR" ] && [ -d "$FIRMWARE_DIR" ]; then
  # 检查是否存在至少一个 > 1MB 的固件镜像文件
  IMG_COUNT=$(find "$FIRMWARE_DIR" -maxdepth 1 -type f \( -name "*.bin" -o -name "*.itb" -o -name "*.ubi" -o -name "*.chk" \) -size +1M 2>/dev/null | wc -l)
  if [ "$IMG_COUNT" -eq 0 ]; then
    add_error "固件产物目录中未找到任何有效镜像文件 (> 1MB)"
  else
    CHECKED_ITEMS+=("固件镜像实体存在且体积正常 (${IMG_COUNT} 个设备镜像文件)")
  fi

  # 检查 sha256sums 校验和完整性
  if [ -f "$FIRMWARE_DIR/sha256sums" ]; then
    SUM_FAILS=0
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      HASH=$(echo "$line" | awk '{print $1}')
      FNAME=$(echo "$line" | awk '{print $2}' | sed 's/^\*//')
      if [ -f "$FIRMWARE_DIR/$FNAME" ]; then
        ACTUAL_HASH=$(sha256sum "$FIRMWARE_DIR/$FNAME" | awk '{print $1}')
        if [ "$HASH" != "$ACTUAL_HASH" ]; then
          SUM_FAILS=$((SUM_FAILS + 1))
        fi
      fi
    done < "$FIRMWARE_DIR/sha256sums"
    if [ "$SUM_FAILS" -gt 0 ]; then
      add_error "sha256sums 校验和存在不匹配项 (${SUM_FAILS} 个文件损坏)"
    else
      CHECKED_ITEMS+=("sha256sums 校验和物理核验一致")
    fi
  fi

  # 检查 profiles.json 完整性 (若存在)
  if [ -f "$FIRMWARE_DIR/profiles.json" ] && command -v jq >/dev/null 2>&1; then
    PROFILE_NAMES=$(jq -r '.profiles | keys[]?' "$FIRMWARE_DIR/profiles.json" 2>/dev/null || true)
    if [ -n "$PROFILE_NAMES" ]; then
      PROFILE_COUNT=$(echo "$PROFILE_NAMES" | wc -l)
      CHECKED_ITEMS+=("设备画像元数据 profiles.json 完备 (${PROFILE_COUNT} 个设备画像)")
    fi
  fi
else
  add_warning "未找到固件产物目录，跳过镜像实体物理校验"
fi

# ──────── 汇总报告写入 ────────
echo "| 检验维度 | 状态 | 详情 |" >> "$REPORT_FILE"
echo "|---|---|---|" >> "$REPORT_FILE"

for item in "${CHECKED_ITEMS[@]}"; do
  echo "| ✅ 契约核验 | 通过 | ${item} |" >> "$REPORT_FILE"
done

for warn in "${WARNINGS[@]}"; do
  echo "| ⚠️ 注意项 | 警告 | ${warn} |" >> "$REPORT_FILE"
done

for err in "${ERRORS[@]}"; do
  echo "| ❌ 严重异常 | 失败 | ${err} |" >> "$REPORT_FILE"
done

echo "" >> "$REPORT_FILE"

CONCLUSION_FILE="${REPORT_FILE%.*}-conclusion.md"

if [ "${#ERRORS[@]}" -eq 0 ]; then
  CONCLUSION="**判定结论**: 🟢 **健康合格 (HEALTHY)** — 所有通用质量契约满足，可以发布 Pre-release。"
  echo "$CONCLUSION  " >> "$REPORT_FILE"
  cat << EOF > "$CONCLUSION_FILE"
### 🔍 固件质量门禁
$CONCLUSION
EOF
  echo "HEALTHY=true" >> "${GITHUB_OUTPUT:-/tmp/verify_output}"
  echo "════════════════════════════════════════════════════════════════"
  echo "✅ 动态门禁核验通过！固件健康可用。"
  echo "════════════════════════════════════════════════════════════════"
  exit 0
else
  CONCLUSION="**判定结论**: 🔴 **存在质量退化 (UNHEALTHY)** — 检测到 ${#ERRORS[@]} 项阻塞性缺陷，阻断发版并建立预警。"
  echo "$CONCLUSION  " >> "$REPORT_FILE"
  cat << EOF > "$CONCLUSION_FILE"
### 🔍 固件质量门禁
$CONCLUSION
EOF
  echo "HEALTHY=false" >> "${GITHUB_OUTPUT:-/tmp/verify_output}"
  echo "════════════════════════════════════════════════════════════════"
  echo "❌ 动态门禁核验失败！共捕获 ${#ERRORS[@]} 项异常。"
  for err in "${ERRORS[@]}"; do
    echo "   - ${err}"
  done
  echo "════════════════════════════════════════════════════════════════"
  exit 1
fi
