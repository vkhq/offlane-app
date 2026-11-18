#!/usr/bin/env bash
# Builds the LGPL FFmpeg the macOS app ships with. Nobody publishes an LGPL
# macOS build, so it is compiled from FFmpeg's pinned source release:
#   - without --enable-gpl and --enable-nonfree, so it stays LGPL;
#   - with VideoToolbox and AudioToolbox for Apple's hardware codecs;
#   - linked only against system frameworks, so it runs on any Mac.
# Merging video and audio is a stream copy, so downloads don't need GPL
# encoders such as x264; users who want them install the GPL build from
# Settings.
#
# Usage: scripts/build-ffmpeg-lgpl-mac.sh [arm64|x86_64 ...]   (default: host)
# Output: vendor/.ffmpeg-mac/<arch>/{ffmpeg,ffprobe,LICENSE.md,version.txt}
# Building x86_64 on Apple silicon uses nasm if installed, else no x86 asm.
set -euo pipefail

VERSION=9.0.2
SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/vendor/.cache/ffmpeg-src"
OUT="$ROOT/vendor/.ffmpeg-mac"

[[ "$(uname)" == Darwin ]] || { echo "macOS only" >&2; exit 1; }
archs=("$@")
[[ ${#archs[@]} -gt 0 ]] || archs=("$(uname -m)")

mkdir -p "$WORK"
tarball="$WORK/ffmpeg-$VERSION.tar.xz"
if [[ ! -f "$tarball" ]]; then
  curl -fL --retry 3 -o "$tarball.part" "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
  mv "$tarball.part" "$tarball"
fi
actual="$(shasum -a 256 "$tarball" | cut -d' ' -f1)"
if [[ "$actual" != "$SHA256" ]]; then
  rm -f "$tarball"
  echo "Checksum mismatch for ffmpeg-$VERSION.tar.xz" >&2
  exit 1
fi

for arch in "${archs[@]}"; do
  echo "▶ ffmpeg $VERSION (LGPL) for $arch"
  src="$WORK/build-$arch"
  rm -rf "$src"
  mkdir -p "$src"
  tar -xJf "$tarball" -C "$src" --strip-components 1
  cd "$src"

  extra=()
  if [[ "$arch" != "$(uname -m)" ]]; then
    extra+=(--enable-cross-compile --target-os=darwin)
  fi
  if [[ "$arch" == x86_64 ]] && ! command -v nasm >/dev/null; then
    echo "  ! nasm not found: building without x86 assembly (slower)."
    extra+=(--disable-x86asm)
  fi

  # pkg-config is turned off so Homebrew libraries (some GPL) are never
  # picked up; everything comes from FFmpeg itself and Apple's frameworks.
  ./configure \
    --arch="$arch" \
    --cc="clang -arch $arch" \
    --extra-cflags="-mmacosx-version-min=11.0" \
    --extra-ldflags="-mmacosx-version-min=11.0" \
    --extra-libs="-liconv" \
    --pkg-config=false \
    --disable-autodetect \
    --enable-videotoolbox \
    --enable-audiotoolbox \
    --enable-zlib \
    --enable-bzlib \
    --enable-iconv \
    --disable-gpl \
    --disable-nonfree \
    --disable-ffplay \
    --disable-doc \
    --disable-debug \
    --enable-static \
    --disable-shared \
    "${extra[@]+"${extra[@]}"}"
  make -j"$(sysctl -n hw.ncpu)"

  # Refuse to hand over anything that isn't LGPL.
  if grep -qE 'CONFIG_GPL 1|CONFIG_NONFREE 1' config.h; then
    echo "Built FFmpeg is not LGPL; refusing to continue" >&2
    exit 1
  fi

  dest="$OUT/$arch"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp ffmpeg ffprobe "$dest/"
  cp LICENSE.md COPYING.LGPLv2.1 "$dest/"
  echo "$VERSION" > "$dest/version.txt"
  cd "$ROOT"
  rm -rf "$src"
  echo "  → ${dest#$ROOT/}"
done
