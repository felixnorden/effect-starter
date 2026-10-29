#!/bin/sh
# Builds or downloads the editor server into packages/editor/bin.
#
# Source checkout: builds packages/editor/bin/mdv-<os>-<arch> and bin/client.
# Installed plugin: downloads the matching tarball from MDV_RELEASE_BASE_URL.
#
# The tarball contains the binary at the root and a client/ directory beside it.
set -eu

plugin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$plugin_dir/../.." && pwd)
install_dir=${MDV_INSTALL_DIR:-"$plugin_dir/bin"}

fail() {
  printf 'markdown-viewer install: %s\n' "$*" >&2
  exit 1
}

if [ -f "$root/packages/app/src/main.ts" ] && command -v bun >/dev/null 2>&1; then
  exec bun "$root/scripts/build-editor-server.ts"
fi

if [ -z "${MDV_RELEASE_BASE_URL:-}" ]; then
  fail "no source checkout with Bun, and MDV_RELEASE_BASE_URL is unset. Install Bun and run this hook from the checkout, or set MDV_RELEASE_BASE_URL to the release directory."
fi

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  MINGW* | MSYS* | CYGWIN*) os=win32 ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

suffix=
[ "$os" = win32 ] && suffix=.exe
name="mdv-$os-$arch$suffix"
asset="mdv-$os-$arch.tar.gz"
base=${MDV_RELEASE_BASE_URL%/}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    fail "curl or wget is required to download $asset"
  fi
}

digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail "sha256sum or shasum is required to verify $asset"
  fi
}

printf 'downloading %s…\n' "$asset"
fetch "$base/$asset" "$tmp/$asset"
fetch "$base/$asset.sha256" "$tmp/$asset.sha256"

expected=$(awk 'NR == 1 {print $1}' "$tmp/$asset.sha256")
actual=$(digest "$tmp/$asset")
[ -n "$expected" ] || fail "empty checksum in $asset.sha256"
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset"

mkdir -p "$tmp/extract"
tar -xzf "$tmp/$asset" -C "$tmp/extract"

[ -f "$tmp/extract/$name" ] || fail "$asset has no $name"
[ -d "$tmp/extract/client" ] || fail "$asset has no client directory"

mkdir -p "$install_dir"
cp "$tmp/extract/$name" "$install_dir/$name"
rm -rf "$install_dir/client"
cp -R "$tmp/extract/client" "$install_dir/client"
chmod +x "$install_dir/$name"

printf 'server: %s\n' "$install_dir/$name"
printf 'client: %s\n' "$install_dir/client"
