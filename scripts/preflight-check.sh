#!/usr/bin/env bash
# ==============================================================================
# Guardians App — Pre-Flight Quality Gate & Release Verification
# ==============================================================================
# Verifies all code quality gates, test suites, required assets, and configuration
# integrity prior to initiating EAS builds and Google Play Store submissions.
#
# Usage:
#   npm run preflight
#   bash scripts/preflight-check.sh
# ==============================================================================

set -u

# Terminal styling & colors
if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  RED="\033[31m"
  YELLOW="\033[33m"
  BLUE="\033[34m"
  CYAN="\033[36m"
  RESET="\033[0m"
else
  BOLD=""
  GREEN=""
  RED=""
  YELLOW=""
  BLUE=""
  CYAN=""
  RESET=""
fi

CHECKMARK="${GREEN}✔${RESET}"
CROSSMARK="${RED}✖${RESET}"
INFO="${BLUE}ℹ${RESET}"
WARN="${YELLOW}⚠${RESET}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TOTAL_STEPS=6
PASSED_STEPS=0
FAILED_STEPS=0
FAILED_NAMES=()

print_header() {
  echo ""
  echo -e "${BOLD}${CYAN}==============================================================================${RESET}"
  echo -e "${BOLD}${CYAN} 🐾 GUARDIANS ANDROID PRE-FLIGHT VERIFICATION GATES${RESET}"
  echo -e "${BOLD}${CYAN}==============================================================================${RESET}"
  echo -e "${INFO} Working Directory : ${ROOT_DIR}"
  echo -e "${INFO} Target Package    : com.guardians.app"
  echo -e "${INFO} Timestamp         : $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo ""
}

run_step() {
  local step_num="$1"
  local step_name="$2"
  local step_cmd="$3"

  echo -e "${BOLD}[${step_num}/${TOTAL_STEPS}] Running: ${step_name}...${RESET}"
  
  local output
  local exit_code=0

  # Capture stdout and stderr
  output=$(eval "$step_cmd" 2>&1) || exit_code=$?

  if [ $exit_code -eq 0 ]; then
    echo -e "    ${CHECKMARK} ${GREEN}${step_name} PASSED${RESET}"
    PASSED_STEPS=$((PASSED_STEPS + 1))
  else
    echo -e "    ${CROSSMARK} ${RED}${step_name} FAILED (Exit code: ${exit_code})${RESET}"
    echo -e "${YELLOW}--- Output Summary ---${RESET}"
    echo "$output" | tail -n 25 | sed 's/^/    /'
    echo -e "${YELLOW}----------------------${RESET}"
    FAILED_STEPS=$((FAILED_STEPS + 1))
    FAILED_NAMES+=("$step_name")
  fi
  echo ""
}

check_production_assets() {
  local step_num="$1"
  local step_name="Production Asset Presence & Integrity"
  echo -e "${BOLD}[${step_num}/${TOTAL_STEPS}] Checking: ${step_name}...${RESET}"

  local asset_errors=0
  local required_assets=(
    "assets/android-icon-foreground.png"
    "assets/android-icon-background.png"
    "assets/android-icon-monochrome.png"
    "assets/splash-icon.png"
    "assets/icon.png"
    "assets/favicon.png"
  )

  for asset in "${required_assets[@]}"; do
    if [ ! -f "$ROOT_DIR/$asset" ]; then
      echo -e "    ${CROSSMARK} Missing required asset: ${asset}"
      asset_errors=$((asset_errors + 1))
    elif [ ! -s "$ROOT_DIR/$asset" ]; then
      echo -e "    ${CROSSMARK} Asset file is empty (0 bytes): ${asset}"
      asset_errors=$((asset_errors + 1))
    else
      local size
      size=$(wc -c < "$ROOT_DIR/$asset" | tr -d ' ')
      echo -e "    ${CHECKMARK} Found ${asset} (${size} bytes)"
    fi
  done

  if [ $asset_errors -eq 0 ]; then
    echo -e "    ${CHECKMARK} ${GREEN}${step_name} PASSED (All 6 core assets verified)${RESET}"
    PASSED_STEPS=$((PASSED_STEPS + 1))
  else
    echo -e "    ${CROSSMARK} ${RED}${step_name} FAILED (${asset_errors} asset error(s))${RESET}"
    FAILED_STEPS=$((FAILED_STEPS + 1))
    FAILED_NAMES+=("$step_name")
  fi
  echo ""
}

check_configuration_integrity() {
  local step_num="$1"
  local step_name="Configuration Integrity (app.config.ts & eas.json)"
  echo -e "${BOLD}[${step_num}/${TOTAL_STEPS}] Checking: ${step_name}...${RESET}"

  local config_errors=0

  # 1. Check app.config.ts existence and content
  if [ ! -f "$ROOT_DIR/app.config.ts" ]; then
    echo -e "    ${CROSSMARK} Missing app.config.ts"
    config_errors=$((config_errors + 1))
  else
    # Check Android package name
    if grep -q "package: 'com.guardians.app'" "$ROOT_DIR/app.config.ts" || grep -q 'package: "com.guardians.app"' "$ROOT_DIR/app.config.ts"; then
      echo -e "    ${CHECKMARK} Android package identifier is 'com.guardians.app'"
    else
      echo -e "    ${CROSSMARK} Android package identifier 'com.guardians.app' not found in app.config.ts"
      config_errors=$((config_errors + 1))
    fi

    # Check Google Maps configuration
    if grep -q "googleMaps" "$ROOT_DIR/app.config.ts" && grep -q "EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY" "$ROOT_DIR/app.config.ts"; then
      echo -e "    ${CHECKMARK} Google Maps Android SDK key configuration wired correctly"
    else
      echo -e "    ${CROSSMARK} Google Maps Android configuration missing in app.config.ts"
      config_errors=$((config_errors + 1))
    fi

    # Check scoped Android permissions
    local required_permissions=("ACCESS_COARSE_LOCATION" "ACCESS_FINE_LOCATION" "CAMERA" "READ_MEDIA_IMAGES")
    local perm_missing=0
    for perm in "${required_permissions[@]}"; do
      if ! grep -q "$perm" "$ROOT_DIR/app.config.ts"; then
        echo -e "    ${CROSSMARK} Required permission '${perm}' missing in app.config.ts"
        perm_missing=$((perm_missing + 1))
      fi
    done
    if [ $perm_missing -eq 0 ]; then
      echo -e "    ${CHECKMARK} Android permissions strictly scoped (Location, Camera, Media Images)"
    else
      config_errors=$((config_errors + perm_missing))
    fi

    # Check absence of deprecated Expo SDK fields
    local deprecated_fields=("newArchEnabled" "android.edgeToEdgeEnabled" "splash:")
    for dep in "${deprecated_fields[@]}"; do
      if grep -q "$dep" "$ROOT_DIR/app.config.ts"; then
        echo -e "    ${CROSSMARK} Deprecated Expo SDK field '${dep}' detected in app.config.ts"
        config_errors=$((config_errors + 1))
      fi
    done
  fi

  # 2. Check eas.json integrity
  if [ ! -f "$ROOT_DIR/eas.json" ]; then
    echo -e "    ${CROSSMARK} Missing eas.json"
    config_errors=$((config_errors + 1))
  else
    # Check build profiles
    if grep -q '"preview"' "$ROOT_DIR/eas.json" && grep -q '"apk"' "$ROOT_DIR/eas.json"; then
      echo -e "    ${CHECKMARK} EAS build profile 'preview' configured for sideloadable APK"
    else
      echo -e "    ${CROSSMARK} EAS build profile 'preview' APK configuration missing"
      config_errors=$((config_errors + 1))
    fi

    if grep -q '"preview-playstore"' "$ROOT_DIR/eas.json" && grep -q '"app-bundle"' "$ROOT_DIR/eas.json"; then
      echo -e "    ${CHECKMARK} EAS build profile 'preview-playstore' configured for App Bundle (.aab)"
    else
      echo -e "    ${CROSSMARK} EAS build profile 'preview-playstore' configuration missing"
      config_errors=$((config_errors + 1))
    fi

    if grep -q '"production"' "$ROOT_DIR/eas.json" && grep -q '"autoIncrement": true' "$ROOT_DIR/eas.json"; then
      echo -e "    ${CHECKMARK} EAS build profile 'production' configured with autoIncrement"
    else
      echo -e "    ${CROSSMARK} EAS build profile 'production' autoIncrement missing"
      config_errors=$((config_errors + 1))
    fi

    if grep -q '"submit"' "$ROOT_DIR/eas.json" && grep -q '"track": "internal"' "$ROOT_DIR/eas.json"; then
      echo -e "    ${CHECKMARK} EAS submit profile configured for Google Play internal track"
    else
      echo -e "    ${CROSSMARK} EAS submit profile for Google Play missing or incomplete"
      config_errors=$((config_errors + 1))
    fi
  fi

  # 3. Check .env.example
  if [ -f "$ROOT_DIR/.env.example" ]; then
    echo -e "    ${CHECKMARK} Environment template (.env.example) present"
  else
    echo -e "    ${CROSSMARK} Missing .env.example"
    config_errors=$((config_errors + 1))
  fi

  if [ $config_errors -eq 0 ]; then
    echo -e "    ${CHECKMARK} ${GREEN}${step_name} PASSED${RESET}"
    PASSED_STEPS=$((PASSED_STEPS + 1))
  else
    echo -e "    ${CROSSMARK} ${RED}${step_name} FAILED (${config_errors} configuration issue(s))${RESET}"
    FAILED_STEPS=$((FAILED_STEPS + 1))
    FAILED_NAMES+=("$step_name")
  fi
  echo ""
}

print_summary() {
  echo -e "${BOLD}${CYAN}==============================================================================${RESET}"
  echo -e "${BOLD}${CYAN} PRE-FLIGHT VERIFICATION SUMMARY${RESET}"
  echo -e "${BOLD}${CYAN}==============================================================================${RESET}"
  echo -e " Total Quality Gates : ${TOTAL_STEPS}"
  echo -e " Passed              : ${GREEN}${PASSED_STEPS}${RESET}"
  echo -e " Failed              : ${RED}${FAILED_STEPS}${RESET}"
  echo ""

  if [ $FAILED_STEPS -eq 0 ]; then
    echo -e "${BOLD}${GREEN}🎉 ALL PRE-FLIGHT CHECKS PASSED! The app is ready for EAS Build & Release.${RESET}"
    echo ""
    echo -e "${INFO} Suggested Next Steps:"
    echo -e "  • Sideloadable Preview APK  : eas build --platform android --profile preview"
    echo -e "  • Play Store Testing AAB    : eas build --platform android --profile preview-playstore"
    echo -e "  • Production Release AAB    : eas build --platform android --profile production"
    echo -e "  • Play Store Submission     : eas submit --platform android --latest"
    echo ""
    exit 0
  else
    echo -e "${BOLD}${RED}❌ PRE-FLIGHT VERIFICATION FAILED! Please resolve the following gates:${RESET}"
    for name in "${FAILED_NAMES[@]}"; do
      echo -e "  ${CROSSMARK} ${RED}${name}${RESET}"
    done
    echo ""
    echo -e "${WARN} Do not proceed with production build until all gates pass cleanly."
    echo ""
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# Main Execution Flow
# ------------------------------------------------------------------------------
print_header

# 1. App TypeScript Validation
run_step 1 "TypeScript Validation (App Code)" "npm run typecheck"

# 2. Test TypeScript Validation
run_step 2 "TypeScript Validation (Test Suite)" "npm run typecheck:test"

# 3. Unit & Contract Test Suite
run_step 3 "Unit & Contract Tests (Jest)" "npm test"

# 4. ESLint Static Analysis
run_step 4 "ESLint Static Analysis" "npm run lint"

# 5. Production Asset Verification
check_production_assets 5

# 6. Configuration Integrity Verification
check_configuration_integrity 6

# Final Summary & Exit
print_summary
