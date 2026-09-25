#!/bin/sh
# Launch the smart board full-screen with no prompts: sound plays without a tap, camera/mic are allowed,
# and tab recording auto-accepts. Usage: scripts/kiosk.sh room-101 [http://localhost:3000]
# macOS path below; on Linux use `google-chrome`, on Windows `chrome.exe` with the same flags.
# ponytail: verify on the actual board hardware — Chrome occasionally renames these switches.
ROOM="${1:?usage: kiosk.sh <room> [base-url]}"
BASE="${2:-http://localhost:3000}"
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --kiosk "$BASE/board/$ROOM" \
  --user-data-dir="$HOME/.ai-board-kiosk" \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --auto-accept-this-tab-capture \
  --noerrdialogs --disable-session-crashed-bubble --no-first-run
