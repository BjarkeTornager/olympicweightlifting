#!/bin/sh
# Runs the app's and the LiftKit package's Swift tests on an iPhone simulator.
# Usage: ios/scripts/test.sh ["iPhone 17 Pro"]
set -eu
cd "$(dirname "$0")/.."
DEVICE="${1:-iPhone 17 Pro}"
# Look the simulator up by name, whichever iOS runtime it has installed.
ID="$(xcrun simctl list devices available | grep -m1 "    $DEVICE (" | grep -oE '[0-9A-F-]{36}')"
DESTINATION="platform=iOS Simulator,id=$ID"
xcodebuild -project LiftJournal.xcodeproj -scheme LiftJournal -destination "$DESTINATION" \
  -skipPackagePluginValidation CODE_SIGNING_ALLOWED=NO test
(cd Packages/LiftKit && xcodebuild -scheme LiftKit -destination "$DESTINATION" \
  -skipPackagePluginValidation test)
