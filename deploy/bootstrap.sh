#!/bin/sh
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run as root'; exit 1; }
base=/opt/dots
mkdir -p "$base/secrets" "$base/state" "$base/computer" "$base/releases" "$base/public/download"
chmod 700 "$base/secrets"
create_disk() {
    image=$1
    size=$2
    mountpoint=$3
    if [ ! -f "$image" ]; then
        truncate -s "$size" "$image"
        mkfs.ext4 -q -F -m 1 "$image"
    fi
    if ! mountpoint -q "$mountpoint"; then
        mount -o loop,nosuid,nodev "$image" "$mountpoint"
    fi
    entry="$image $mountpoint ext4 loop,nosuid,nodev 0 0"
    grep -Fqx "$entry" /etc/fstab || printf '%s\n' "$entry" >> /etc/fstab
}
create_disk "$base/state.ext4" 512M "$base/state"
create_disk "$base/computer.ext4" 6G "$base/computer"
mkdir -p "$base/computer/home" "$base/computer/workspace" "$base/computer/browser"
chown 10001:10001 "$base/state"
chown 10003:10003 "$base/computer/home"
chown 10003:10002 "$base/computer/workspace"
chown 10002:10002 "$base/computer/browser"
chmod 700 "$base/state" "$base/computer/home" "$base/computer/browser"
chmod 2770 "$base/computer/workspace"
if [ ! -f "$base/secrets/runtime.env" ]; then
    umask 077
    python3 -c 'import secrets; from pathlib import Path; Path("/opt/dots/secrets/runtime.env").write_text("RUNTIME_TOKEN=" + secrets.token_urlsafe(48) + "\nAGENT_TOKEN=" + secrets.token_urlsafe(48) + "\n")'
fi
chmod 600 "$base/secrets/runtime.env"
echo 'dots: independent state 512MiB + computer 6GiB; existing containers/databases untouched'
