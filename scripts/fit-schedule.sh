#!/bin/zsh -l
# FIT の取り込み（scripts/import-fit.mjs --post）を毎日 launchd で回す。
#
# なぜこの Mac 上の launchd なのか。FIT は HealthFit が Google Drive に書き出したものを
# 読むしかなく、CI や Vercel からは触れない。Drive API を足せば取りに行けるが、認証の
# 設定を増やさないというのが取り込み全体の方針（docs/fit-import-setup.md）なので、
# 同期済みのフォルダが見えるこの Mac に置く。
#
#   scripts/fit-schedule.sh install [FIT のフォルダ]   # 毎日 22:00 に登録する
#   scripts/fit-schedule.sh uninstall                  # 登録を外す
#   scripts/fit-schedule.sh run                        # launchd が呼ぶ入口。手で叩いてもよい
#
# 取り込みは開始日時をキーにした上書きなので、遅れて走っても行は増えない。走らなかった日の
# 分は翌日の実行がまとめて拾う。だから失敗を即座にリトライする必要はない。
set -e

LABEL="dev.shun2218.ichirizuka-fit"
REPO="${0:A:h:h}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
# ログはリポジトリに置かない（.gitignore を増やさずに済み、macOS の置き場に従う）
LOG="$HOME/Library/Logs/ichirizuka/import-fit.log"
DEFAULT_FIT_DIR="$HOME/Google Drive/My Drive/HealthFit"
HOUR=22

# 止まっても気づけるようにする。ログだけだと見に行かないので、通知を出してから落ちる
# （docs/fit-import-setup.md「定期実行について」）。
fail() {
  print -u2 "[fit-schedule] 失敗: $1"
  /usr/bin/osascript -e "display notification \"$1\" with title \"ichirizuka: FIT の取り込み\"" 2>/dev/null || true
  exit 1
}

run() {
  local dir="${ICHIRIZUKA_FIT_DIR:-$DEFAULT_FIT_DIR}"
  cd "$REPO"
  print "[fit-schedule] $(date '+%Y-%m-%d %H:%M:%S %Z') start dir=$dir"

  # Drive の同期が外れるとフォルダごと消える。0 本を淡々と送るより止める
  [[ -d $dir ]] || fail "FIT のフォルダが見つからない: $dir"

  # launchd の PATH には mise が無いので自分で解決する
  local mise="${commands[mise]:-/opt/homebrew/bin/mise}"
  [[ -x $mise ]] || fail "mise が見つからない: $mise"

  "$mise" exec -- node scripts/import-fit.mjs "$dir" --post \
    || fail "取り込みに失敗した。ログ: $LOG"

  print "[fit-schedule] $(date '+%Y-%m-%d %H:%M:%S %Z') done"
}

install_agent() {
  local dir="${1:-$DEFAULT_FIT_DIR}"
  [[ -d $dir ]] || fail "FIT のフォルダが見つからない: $dir"

  mkdir -p "$HOME/Library/LaunchAgents" "${LOG:h}"

  # plist は $HOME を展開しないため実際のパスを埋める必要がある。公開リポジトリに
  # 自分のホームのパスを置かないよう、テンプレートを持たずここで生成する。
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ichirizuka: FIT の取り込み。scripts/fit-schedule.sh install が生成し、
     uninstall が消す。手で直さず、スクリプト側を直して入れ直すこと。 -->
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$REPO/scripts/fit-schedule.sh</string><string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>ICHIRIZUKA_FIT_DIR</key><string>$dir</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>ProcessType</key><string>Standard</string>
</dict>
</plist>
PLIST

  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$PLIST"

  print "登録した: $LABEL（毎日 $HOUR:00）"
  print "  FIT   $dir"
  print "  ログ  $LOG"
  print "  確認  launchctl print gui/$UID/$LABEL"
  print "  試す  launchctl kickstart -p gui/$UID/$LABEL"
}

uninstall_agent() {
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  print "外した: $LABEL"
}

case "$1" in
  install) install_agent "$2" ;;
  uninstall) uninstall_agent ;;
  run) run ;;
  *)
    print -u2 "使い方: scripts/fit-schedule.sh install [FIT のフォルダ] | uninstall | run"
    exit 2
    ;;
esac
