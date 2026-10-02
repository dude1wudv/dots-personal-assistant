#!/bin/sh
set -eu
base=/opt/dots
version=${1:?Usage: sign-apk.sh version}
python3 -c 'import re, sys; assert re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", sys.argv[1]), "invalid APK version"' "$version"
install -m 700 -d "$base/secrets/android-signing"
install -m 755 -d "$base/public/download"
if [ ! -f "$base/secrets/android-signing/password" ]; then
    umask 077
    python3 -c 'import secrets; from pathlib import Path; Path("/opt/dots/secrets/android-signing/password").write_text(secrets.token_urlsafe(48) + "\n")'
fi
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    -e DOTS_APK_VERSION="$version" \
    --tmpfs /tmp:size=64m,mode=1777 \
    -v "$base/secrets/android-signing:/signing" \
    -v "$base/artifacts:/artifacts:ro" \
    -v "$base/public/download:/output" \
    eclipse-temurin:17-jdk sh -eu -c '
        if [ ! -f /signing/release.p12 ]; then
            keytool -genkeypair -keystore /signing/release.p12 -storetype PKCS12 -storepass:file /signing/password -keypass:file /signing/password -alias dots -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=MicroEduLab Dots, OU=Personal Companion, O=MicroEduLab"
        fi
        java -jar /artifacts/apksigner.jar sign --ks /signing/release.p12 --ks-key-alias dots --ks-pass file:/signing/password --out "/output/dots-${DOTS_APK_VERSION}.apk" /artifacts/dots-release-unsigned.apk
        java -jar /artifacts/apksigner.jar verify --verbose --print-certs "/output/dots-${DOTS_APK_VERSION}.apk"
    '
chmod 600 "$base/secrets/android-signing/"*
chmod 644 "$base/public/download/dots-${version}.apk"
sha256sum "$base/public/download/dots-${version}.apk"
