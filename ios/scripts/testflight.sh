#!/bin/sh
# Archives a Release build and uploads it to App Store Connect for TestFlight.
# Internal testers get it after processing; the external group needs it added
# (and, for the first build of a version, Beta App Review). Signing is
# automatic for team 9B79882UPS.
#
# Usage: ios/scripts/testflight.sh
# The build number is set from the UTC date and time, so every upload is
# higher than the last (App Store Connect requires this) and fits the
# server's X-Client build check.
#
# It signs in to App Store Connect with an API key when one is set up, and
# otherwise with the Apple Account in Xcode › Settings › Apple Accounts, whose
# sign-in expires within the hour ("exportArchive Failed to Use Accounts").
# To set up the key, put its two IDs in ~/.appstoreconnect/lift-journal.env:
#   ASC_KEY_ID=ABC123DEF4
#   ASC_ISSUER_ID=00000000-0000-0000-0000-000000000000
# and the downloaded key at ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8
# (or set ASC_KEY_PATH). The IDs aren't secret; the .p8 file is, so it lives
# outside the repository.
set -eu
cd "$(dirname "$0")/.."
BUILD="$(date -u +%y%j%H%M)"
OUT="${TMPDIR:-/tmp}/lift-journal-testflight"
rm -rf "$OUT"
mkdir -p "$OUT"

CONFIG="$HOME/.appstoreconnect/lift-journal.env"
if [ -z "${ASC_KEY_ID:-}" ] && [ -f "$CONFIG" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG"
fi
set --
if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
  KEY="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}"
  if [ ! -f "$KEY" ]; then
    echo "App Store Connect key not found at $KEY" >&2
    exit 1
  fi
  set -- -authenticationKeyPath "$KEY" -authenticationKeyID "$ASC_KEY_ID" \
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
  echo "Signing in to App Store Connect with API key $ASC_KEY_ID."
else
  echo "No App Store Connect API key set up; using the Apple Account in Xcode."
fi

xcodebuild -project LiftJournal.xcodeproj -scheme LiftJournal -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/LiftJournal.xcarchive" \
  -skipPackagePluginValidation -allowProvisioningUpdates "$@" \
  CURRENT_PROJECT_VERSION="$BUILD" archive

xcodebuild -exportArchive -archivePath "$OUT/LiftJournal.xcarchive" \
  -exportOptionsPlist scripts/ExportOptions.plist -exportPath "$OUT/export" \
  -allowProvisioningUpdates "$@"

echo "Uploaded build $BUILD. It appears in App Store Connect › TestFlight after processing (usually 5–15 minutes)."
