#!/bin/sh
# Archives a Release build and uploads it to App Store Connect for TestFlight.
# Internal testers get it after processing; the external group needs it added
# (and, for the first build of a version, Beta App Review). Uses the Apple
# Account signed in to Xcode (Settings › Apple Accounts) and automatic signing
# for team 9B79882UPS.
#
# Usage: ios/scripts/testflight.sh
# The build number is set from the UTC date and time, so every upload is
# higher than the last (App Store Connect requires this) and fits the
# server's X-Client build check.
set -eu
cd "$(dirname "$0")/.."
BUILD="$(date -u +%y%j%H%M)"
OUT="${TMPDIR:-/tmp}/lift-journal-testflight"
rm -rf "$OUT"
mkdir -p "$OUT"

xcodebuild -project LiftJournal.xcodeproj -scheme LiftJournal -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/LiftJournal.xcarchive" \
  -skipPackagePluginValidation -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$BUILD" archive

xcodebuild -exportArchive -archivePath "$OUT/LiftJournal.xcarchive" \
  -exportOptionsPlist scripts/ExportOptions.plist -exportPath "$OUT/export" \
  -allowProvisioningUpdates

echo "Uploaded build $BUILD. It appears in App Store Connect › TestFlight after processing (usually 5–15 minutes)."
