#!/usr/bin/env bash
# Builds the LGPL FFmpeg the macOS app ships with. Nobody publishes an LGPL
# macOS build, so it is compiled from FFmpeg's pinned source release:
#   - without --enable-gpl and --enable-nonfree, so it stays LGPL;
#   - with VideoToolbox and AudioToolbox for Apple's hardware codecs;
#   - without FFmpeg's own HEVC and VVC decoders, which patent pools cover:
#     Offlane ships no HEVC code. (macOS's own encoder and decoder, through
#     VideoToolbox, are the system's. Reading an HEVC file's details and
#     copying its stream need no decoder.)
#   - with the libraries below, each built here from a pinned tarball as a
#     static library, so the result links only against system frameworks
#     and runs on any Mac.
# Users who want GPL encoders such as x264 install the GPL build from
# Settings.
#
# Usage: scripts/build-ffmpeg-lgpl-mac.sh [arm64|x86_64 ...]   (default: host)
# Output: vendor/.ffmpeg-mac/<arch>/{ffmpeg,ffprobe,version.txt,licenses/}
#         licenses/ holds every component's licence and SOURCES.txt, the
#         list of source tarballs (with SHA-256) the build was made from.
# Needs: Xcode command line tools, pkg-config, python3 (for meson and ninja,
# installed at pinned versions into vendor/.cache/build-tools).
# Building x86_64 on Apple silicon uses nasm if installed, else no x86 asm.
set -euo pipefail

VERSION=9.0.2
SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
MESON_VERSION=1.12.1
NINJA_VERSION=1.13.2
MACOS_MIN=11.0

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/vendor/.cache/ffmpeg-src"
OUT="$ROOT/vendor/.ffmpeg-mac"
TOOLS="$ROOT/vendor/.cache/build-tools"

# The libraries, in build order. Each line:
#   name version sha256 url [fallback url]
# and, beside it, which tool needs it. Hashes were checked against the
# publisher's SHA256SUMS (Xiph), signature (FreeType, libass) or the
# well-known hash (LAME) when pinned; libvpx, FriBidi and HarfBuzz publish
# neither, so theirs are the hashes of the downloads when pinned.
DEPS="
libogg 1.3.6 5c8253428e181840cd20d41f3ca16557a9cc04bad4a3d04cce84808677fa1061 https://downloads.xiph.org/releases/ogg/libogg-1.3.6.tar.xz
libvorbis 1.3.7 b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b https://downloads.xiph.org/releases/vorbis/libvorbis-1.3.7.tar.xz
opus 1.6.1 6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1 https://downloads.xiph.org/releases/opus/opus-1.6.1.tar.gz
lame 3.100 ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz
libvpx 1.17.0 1020f184046187baa2985dbde38e0691f49c44088bca7a1842b0236c6081dc0a https://github.com/webmproject/libvpx/archive/refs/tags/v1.17.0.tar.gz
freetype 2.15.0 93cd47eb719c325107f2d3cf087d06299e944c3b48a40b55537302304dea1dd5 https://download.savannah.gnu.org/releases/freetype/freetype-2.15.0.tar.xz https://downloads.sourceforge.net/project/freetype/freetype2/2.15.0/freetype-2.15.0.tar.xz
fribidi 1.0.18 1de5e8073d035388b71d0b2d452b1da1f8caeea8a7702997b401fe1b6250727f https://github.com/fribidi/fribidi/releases/download/v1.0.18/fribidi-1.0.18.tar.xz
harfbuzz 15.1.0 0fc7c565443a5f4be7da65ac5ee5bd737d9b158dc908708b7689a0a5796b0c8d https://github.com/harfbuzz/harfbuzz/releases/download/15.1.0/harfbuzz-15.1.0.tar.xz
libass 0.17.5 2dca25c0e0c837ddf00b52011b3f82cac1e4ddd3ad018227806b0c2288864acc https://github.com/libass/libass/releases/download/0.17.5/libass-0.17.5.tar.xz
"
# What each library gives the tools:
#   libmp3lame (lame)        MP3: Convert, Extract, Trim and Record Audio; AVI audio in Convert Video
#   libvorbis (+ libogg)     OGG: Convert, Extract and Trim Audio
#   libopus (opus)           Opus audio in WebM: Convert Video
#   libvpx                   VP9 video in WebM: Convert Video
#   libass (+ freetype, fribidi, harfbuzz)
#                            the subtitles filter: Burn In Subtitles

# Each component's licence files, as "<name>:<file in its source>".
LICENSES="
FFmpeg:LICENSE.md FFmpeg:COPYING.LGPLv2.1
libogg:COPYING libvorbis:COPYING opus:COPYING lame:COPYING
libvpx:LICENSE libvpx:PATENTS
freetype:LICENSE.TXT freetype:docs/FTL.TXT
fribidi:COPYING harfbuzz:COPYING libass:COPYING
"

[[ "$(uname)" == Darwin ]] || { echo "macOS only" >&2; exit 1; }
command -v pkg-config >/dev/null || { echo "pkg-config is needed (brew install pkg-config)" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is needed" >&2; exit 1; }
archs=("$@")
[[ ${#archs[@]} -gt 0 ]] || archs=("$(uname -m)")
JOBS="$(sysctl -n hw.ncpu)"

mkdir -p "$WORK"

# Downloads $3 (then $4…) to $WORK/$1 unless already there, and checks it
# against $2. A file that doesn't match is deleted.
fetch() {
  local file="$WORK/$1" sha="$2" url
  shift 2
  if [[ ! -f "$file" ]]; then
    for url in "$@"; do
      if curl -fL --retry 3 --connect-timeout 20 -o "$file.part" "$url"; then
        mv "$file.part" "$file"
        break
      fi
    done
  fi
  [[ -f "$file" ]] || { echo "Couldn't download $(basename "$file")" >&2; exit 1; }
  if [[ "$(shasum -a 256 "$file" | cut -d' ' -f1)" != "$sha" ]]; then
    rm -f "$file"
    echo "Checksum mismatch for $(basename "$file")" >&2
    exit 1
  fi
}

# The tarball name of a library's URL, with its version, e.g. libvpx's
# v1.17.0.tar.gz becomes libvpx-1.17.0.tar.gz.
tarball_of() {
  local name="$1" version="$2" url="$3"
  local ext="${url##*.tar.}"
  echo "$name-$version.tar.$ext"
}

fetch "ffmpeg-$VERSION.tar.xz" "$SHA256" "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
while read -r name version sha url fallback; do
  [[ -n "$name" ]] || continue
  fetch "$(tarball_of "$name" "$version" "$url")" "$sha" "$url" ${fallback:+"$fallback"}
done <<< "$DEPS"

# meson and ninja (for FriBidi and HarfBuzz), pinned, in their own venv.
if [[ ! -x "$TOOLS/bin/meson" ]] ||
  [[ "$("$TOOLS/bin/meson" --version)" != "$MESON_VERSION" ]] ||
  [[ "$("$TOOLS/bin/ninja" --version)" != "$NINJA_VERSION" ]]; then
  rm -rf "$TOOLS"
  python3 -m venv "$TOOLS"
  "$TOOLS/bin/pip" install --quiet --disable-pip-version-check \
    "meson==$MESON_VERSION" "ninja==$NINJA_VERSION"
fi
MESON="$TOOLS/bin/meson"
export PATH="$TOOLS/bin:$PATH"

# Unpacks a library's tarball into $1 (a fresh folder).
unpack() {
  local dest="$1" name="$2" version="$3" url="$4"
  rm -rf "$dest"
  mkdir -p "$dest"
  tar -xf "$WORK/$(tarball_of "$name" "$version" "$url")" -C "$dest" --strip-components 1
}

for arch in "${archs[@]}"; do
  echo "▶ ffmpeg $VERSION (LGPL) for $arch"
  host_triple="$([[ "$arch" == arm64 ]] && echo aarch64-apple-darwin || echo x86_64-apple-darwin)"
  cross=0
  [[ "$arch" == "$(uname -m)" ]] || cross=1
  have_nasm=0
  command -v nasm >/dev/null && have_nasm=1

  build="$WORK/build-$arch"
  prefix="$WORK/deps-$arch"
  export CC="clang -arch $arch"
  export CXX="clang++ -arch $arch"
  export CFLAGS="-arch $arch -mmacosx-version-min=$MACOS_MIN -O2"
  export CXXFLAGS="$CFLAGS"
  export LDFLAGS="-arch $arch -mmacosx-version-min=$MACOS_MIN"
  # Only our own libraries: never Homebrew's (some are GPL) or the system's.
  export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"
  unset PKG_CONFIG_PATH
  autotools=(--prefix="$prefix" --disable-shared --enable-static)
  [[ $cross == 0 ]] || autotools+=(--host="$host_triple")
  meson_opts=(--prefix="$prefix" --libdir=lib --buildtype=release --default-library=static -Db_ndebug=true)
  if [[ $cross == 1 ]]; then
    cross_file="$WORK/meson-cross-$arch.ini"
    cat > "$cross_file" <<EOF
[binaries]
c = ['clang', '-arch', '$arch']
cpp = ['clang++', '-arch', '$arch']
ar = 'ar'
strip = 'strip'
pkg-config = 'pkg-config'
[host_machine]
system = 'darwin'
cpu_family = '$([[ "$arch" == arm64 ]] && echo aarch64 || echo x86_64)'
cpu = '$arch'
endian = 'little'
EOF
    meson_opts+=(--cross-file="$cross_file")
  fi

  # The libraries are rebuilt only when this script changes.
  stamp="$prefix/.built"
  wanted="$(shasum -a 256 "$0" | cut -d' ' -f1)"
  if [[ "$(cat "$stamp" 2>/dev/null)" != "$wanted" ]]; then
    rm -rf "$prefix"
    mkdir -p "$prefix"
    while read -r name version sha url fallback; do
      [[ -n "$name" ]] || continue
      echo "  • $name $version"
      src="$build/$name"
      unpack "$src" "$name" "$version" "$url"
      log="$build/$name.log"
      # In the background, so `set -e` still applies inside (it doesn't in
      # a subshell followed by ||).
      (
        set -e
        cd "$src"
        case "$name" in
          libogg)
            ./configure "${autotools[@]}"
            make -j"$JOBS" install ;;
          libvorbis)
            # Its configure adds a flag current clang rejects.
            sed -i '' 's/-force_cpusubtype_ALL//g' configure
            ./configure "${autotools[@]}" --disable-oggtest --disable-docs --disable-examples
            make -j"$JOBS" install ;;
          opus)
            ./configure "${autotools[@]}" --disable-doc --disable-extra-programs
            make -j"$JOBS" install ;;
          lame)
            # Its 2017 config.guess predates Apple silicon; libogg's is newer.
            cp "$build/libogg/config.guess" "$build/libogg/config.sub" .
            ./configure "${autotools[@]}" --disable-frontend --disable-gtktest --disable-decoder
            make -j"$JOBS" install ;;
          libvpx)
            # Any darwin20+ target only adds -arch; the minimum macOS comes
            # from --extra-cflags. (Not looked up: `configure --help` exits 1.)
            if [[ "$arch" == arm64 ]]; then
              target=arm64-darwin20-gcc
            elif [[ $have_nasm == 1 ]]; then
              target=x86_64-darwin20-gcc
            else
              target=generic-gnu
            fi
            # libvpx's configure picks its own -arch from the target.
            env -u CC -u CXX ./configure --prefix="$prefix" --target="$target" \
              --disable-shared --enable-static --enable-pic \
              --disable-examples --disable-tools --disable-docs --disable-unit-tests \
              --extra-cflags="-mmacosx-version-min=$MACOS_MIN"
            make -j"$JOBS" install ;;
          freetype)
            # FreeType 2.15 links Apple's libhvf whenever the SDK has it,
            # which macOS before 15.4 lacks: the binary wouldn't start
            # there. Libass doesn't need HVF fonts, so it's left out.
            ./configure "${autotools[@]}" --with-zlib=no --with-bzip2=no \
              --with-png=no --with-harfbuzz=no --with-brotli=no \
              ac_cv_header_hvf_Scaler_h=no
            make -j"$JOBS" install ;;
          fribidi)
            "$MESON" setup _build "${meson_opts[@]}" -Ddocs=false -Dtests=false -Dbin=false
            "$MESON" install -C _build ;;
          harfbuzz)
            "$MESON" setup _build "${meson_opts[@]}" -Dfreetype=enabled \
              -Dglib=disabled -Dgobject=disabled -Dcairo=disabled -Dicu=disabled \
              -Dgraphite2=disabled -Dchafa=disabled -Dcoretext=disabled \
              -Dtests=disabled -Ddocs=disabled -Dutilities=disabled \
              -Dintrospection=disabled -Dbenchmark=disabled
            "$MESON" install -C _build ;;
          libass)
            asm=()
            [[ "$arch" == arm64 || $have_nasm == 1 ]] || asm=(--disable-asm)
            ./configure "${autotools[@]}" --disable-fontconfig --enable-coretext \
              --disable-require-system-font-provider --disable-libunibreak \
              "${asm[@]+"${asm[@]}"}"
            make -j"$JOBS" install ;;
        esac
      ) > "$log" 2>&1 &
      wait $! || { echo "Building $name failed; see ${log#$ROOT/}" >&2; tail -30 "$log" >&2; exit 1; }
    done <<< "$DEPS"
    echo "$wanted" > "$stamp"
  else
    echo "  • libraries already built"
  fi

  src="$build/ffmpeg"
  rm -rf "$src"
  mkdir -p "$src"
  tar -xJf "$WORK/ffmpeg-$VERSION.tar.xz" -C "$src" --strip-components 1
  cd "$src"

  extra=()
  if [[ $cross == 1 ]]; then
    extra+=(--enable-cross-compile --target-os=darwin)
  fi
  if [[ "$arch" == x86_64 && $have_nasm == 0 ]]; then
    echo "  ! nasm not found: building without x86 assembly (slower)."
    extra+=(--disable-x86asm)
  fi

  # pkg-config sees only $prefix (PKG_CONFIG_LIBDIR above), and every
  # library is static, so nothing from Homebrew can be linked in.
  # HarfBuzz is C++, hence -lc++.
  env -u CC -u CXX -u CFLAGS -u CXXFLAGS -u LDFLAGS ./configure \
    --arch="$arch" \
    --cc="clang -arch $arch" \
    --cxx="clang++ -arch $arch" \
    --extra-cflags="-mmacosx-version-min=$MACOS_MIN -I$prefix/include" \
    --extra-ldflags="-mmacosx-version-min=$MACOS_MIN -L$prefix/lib" \
    --extra-libs="-liconv -lc++" \
    --pkg-config=pkg-config \
    --pkg-config-flags=--static \
    --disable-autodetect \
    --enable-videotoolbox \
    --enable-audiotoolbox \
    --enable-zlib \
    --enable-bzlib \
    --enable-iconv \
    --enable-libmp3lame \
    --enable-libvorbis \
    --enable-libopus \
    --enable-libvpx \
    --enable-libass \
    --enable-libfreetype \
    --enable-libfribidi \
    --enable-libharfbuzz \
    --disable-gpl \
    --disable-nonfree \
    --disable-decoder=hevc --disable-parser=hevc \
    --disable-decoder=vvc --disable-parser=vvc \
    --disable-ffplay \
    --disable-doc \
    --disable-debug \
    --enable-static \
    --disable-shared \
    "${extra[@]+"${extra[@]}"}" > "$build/ffmpeg-configure.log" 2>&1 ||
    { echo "FFmpeg's configure failed; see ${build#$ROOT/}/ffmpeg-configure.log and ffbuild/config.log" >&2; tail -20 ffbuild/config.log >&2; exit 1; }
  make -j"$JOBS" > "$build/ffmpeg-make.log" 2>&1 ||
    { echo "Building FFmpeg failed; see ${build#$ROOT/}/ffmpeg-make.log" >&2; tail -30 "$build/ffmpeg-make.log" >&2; exit 1; }

  # Refuse to hand over anything that isn't LGPL…
  if grep -qE 'CONFIG_GPL 1|CONFIG_NONFREE 1' config.h; then
    echo "Built FFmpeg is not LGPL; refusing to continue" >&2
    exit 1
  fi
  # …that has HEVC or VVC code of its own…
  if grep -E '^#define CONFIG_((HEVC|VVC)_(DECODER|PARSER)|LIBX265|LIBKVAZAAR|LIBVVENC|LIBDE265)(_[A-Z]+)? 1' config.h; then
    echo "Built FFmpeg has HEVC or VVC code; refusing to continue" >&2
    exit 1
  fi
  # …or that links against anything but system frameworks and the few
  # /usr/lib libraries every macOS since 11 has. (A library from a newer
  # SDK, such as FreeType's libhvf, would stop it starting on older Macs.)
  for bin in ffmpeg ffprobe; do
    foreign="$(otool -L "$bin" | tail -n +2 | awk '{print $1}' |
      grep -vE '^/System/Library/Frameworks/' |
      grep -vE '^/usr/lib/lib(System\.B|z\.1|bz2\.1\.0|iconv\.2|c\+\+\.1)\.dylib$' || true)"
    if [[ -n "$foreign" ]]; then
      echo "$bin links against libraries an older Mac may not have: $foreign" >&2
      exit 1
    fi
  done

  dest="$OUT/$arch"
  rm -rf "$dest"
  mkdir -p "$dest/licenses"
  cp ffmpeg ffprobe "$dest/"
  for entry in $LICENSES; do
    name="${entry%%:*}" file="${entry#*:}"
    from="$([[ "$name" == FFmpeg ]] && echo "$src" || echo "$build/$name")/$file"
    cp "$from" "$dest/licenses/$name-$(basename "$file")"
  done
  {
    echo "Offlane's LGPL FFmpeg for macOS ($arch) was built by"
    echo "scripts/build-ffmpeg-lgpl-mac.sh from these source releases:"
    echo
    echo "ffmpeg $VERSION $SHA256 https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
    while read -r name version sha url fallback; do
      [[ -n "$name" ]] && echo "$name $version $sha $url"
    done <<< "$DEPS"
  } > "$dest/licenses/SOURCES.txt"
  echo "$VERSION" > "$dest/version.txt"
  cd "$ROOT"
  rm -rf "$src"
  echo "  → ${dest#$ROOT/}"
done
