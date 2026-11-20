#!/usr/bin/env node
// Downloads the engine binaries for development and the tests, checks each
// against its publisher's SHA-256, and lays them out as
//
//   vendor/<os>-<arch>/bin/
//     yt-dlp/yt-dlp[.exe]   yt-dlp "onedir" build (+ _internal/)
//     ffmpeg[.exe]          LGPL build only; see the guard below
//     ffprobe[.exe]
//     licenses/             FFmpeg's LGPL text, yt-dlp's third-party notices
//     versions.json         what was fetched, from where, with which hash
//
// Nothing here is bundled into the app. FFmpeg is published as the Media
// toolkit (`npm run publish-toolkits`). yt-dlp is for the tests and
// OFFLANE_USE_VENDOR=1 only: the app never ships or downloads it, and uses
// the person's own (see src/shared/externalTools.ts).
//
//   node scripts/fetch-binaries.mjs                  # this machine
//   node scripts/fetch-binaries.mjs --target=win-x64 # one target
//   node scripts/fetch-binaries.mjs --all            # every target (CI)
//
// Pin versions: YTDLP_VERSION, FFMPEG_TAG (BtbN tag). macOS has no published LGPL FFmpeg, so it is built from
// source by scripts/build-ffmpeg-lgpl-mac.sh (or taken from FFMPEG_MAC_DIR).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import extractZip from 'extract-zip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');
const CACHE = path.join(VENDOR, '.cache');

const gh = (repo, tag, asset) =>
  tag
    ? `https://github.com/${repo}/releases/download/${tag}/${asset}`
    : `https://github.com/${repo}/releases/latest/download/${asset}`;

const YTDLP_TAG = process.env.YTDLP_VERSION || '';
const FFMPEG_TAG = process.env.FFMPEG_TAG || 'latest';

// Each yt-dlp onedir zip has a differently named executable (exeInZip),
// renamed to yt-dlp[.exe] so the app never cares.
const TARGETS = {
  'win-x64': {
    ytdlp: { asset: 'yt-dlp_win.zip', exeInZip: 'yt-dlp.exe' },
    ffmpeg: { asset: 'ffmpeg-n9.0-latest-win64-lgpl-9.0.zip' },
    exe: '.exe',
  },
  'win-arm64': {
    ytdlp: { asset: 'yt-dlp_win_arm64.zip', exeInZip: 'yt-dlp_arm64.exe' },
    ffmpeg: { asset: 'ffmpeg-n9.0-latest-winarm64-lgpl-9.0.zip' },
    exe: '.exe',
  },
  'mac-x64': {
    // The macOS yt-dlp build is universal.
    ytdlp: { asset: 'yt-dlp_macos.zip', exeInZip: 'yt-dlp_macos' },
    ffmpeg: { buildArch: 'x86_64' },
    exe: '',
  },
  'mac-arm64': {
    ytdlp: { asset: 'yt-dlp_macos.zip', exeInZip: 'yt-dlp_macos' },
    ffmpeg: { buildArch: 'arm64' },
    exe: '',
  },
  'linux-x64': {
    ytdlp: { asset: 'yt-dlp_linux.zip', exeInZip: 'yt-dlp_linux' },
    ffmpeg: { asset: 'ffmpeg-n9.0-latest-linux64-lgpl-9.0.tar.xz' },
    exe: '',
  },
  'linux-arm64': {
    ytdlp: {
      asset: 'yt-dlp_linux_aarch64.zip',
      exeInZip: 'yt-dlp_linux_aarch64',
    },
    ffmpeg: { asset: 'ffmpeg-n9.0-latest-linuxarm64-lgpl-9.0.tar.xz' },
    exe: '',
  },
};

function hostTarget() {
  const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
  if (!os) throw new Error(`Unsupported host platform: ${process.platform}`);
  return `${os}-${process.arch}`;
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Downloads to `dest`, reusing a cached copy unless `fresh`. */
async function download(url, dest, fresh) {
  if (fresh) await fs.rm(dest, { force: true });
  if (existsSync(dest)) return dest;
  console.log(`  ↓ ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const tmp = `${dest}.part`;
  await fs.writeFile(tmp, Buffer.from(await response.arrayBuffer()));
  // Renamed only once complete, so a crash never leaves a "cached" half file.
  await fs.rename(tmp, dest);
  return dest;
}

/** A "<hash>  <file>" checksum list as a Map. */
async function fetchChecksums(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const sums = new Map();
  for (const line of (await response.text()).split('\n')) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match) sums.set(match[2].trim(), match[1].toLowerCase());
  }
  return sums;
}

async function verify(file, expected, label) {
  if (!expected) {
    throw new Error(`No published checksum for ${label}; refusing to continue`);
  }
  const actual = await sha256File(file);
  if (actual !== expected) {
    await fs.rm(file, { force: true });
    throw new Error(
      `Checksum mismatch for ${label}\n  expected ${expected}\n  got      ${actual}`,
    );
  }
  console.log(`  ✓ sha256 ok: ${label}`);
  return actual;
}

async function chmodX(file) {
  if (process.platform !== 'win32') await fs.chmod(file, 0o755);
}

async function fetchYtdlp(target, spec, binDir, exe, versions) {
  const sums = await fetchChecksums(
    gh('yt-dlp/yt-dlp', YTDLP_TAG, 'SHA2-256SUMS'),
  );
  const archive = path.join(CACHE, `${YTDLP_TAG || 'latest'}-${spec.asset}`);
  // "latest" moves, so a cached "latest" archive is never trusted.
  await download(
    gh('yt-dlp/yt-dlp', YTDLP_TAG, spec.asset),
    archive,
    !YTDLP_TAG,
  );
  const sha256 = await verify(archive, sums.get(spec.asset), spec.asset);

  // PyInstaller finds _internal/ relative to the executable, so renaming is
  // safe.
  const dir = path.join(binDir, 'yt-dlp');
  await fs.rm(dir, { recursive: true, force: true });
  await extractZip(archive, { dir });
  const finalExe = path.join(dir, `yt-dlp${exe}`);
  await fs.rename(path.join(dir, spec.exeInZip), finalExe);
  await chmodX(finalExe);
  const notices = path.join(dir, '_internal', 'THIRD_PARTY_LICENSES.txt');
  if (existsSync(notices)) {
    await fs.copyFile(
      notices,
      path.join(binDir, 'licenses', 'yt-dlp-THIRD_PARTY_LICENSES.txt'),
    );
  }

  let version = YTDLP_TAG || 'unknown';
  if (target === hostTarget()) {
    const result = spawnSync(finalExe, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) version = result.stdout.trim();
  }
  versions.ytdlp = { version, asset: spec.asset, sha256 };
}

/** macOS: the LGPL build from scripts/build-ffmpeg-lgpl-mac.sh. */
async function macFfmpeg(spec, binDir, versions) {
  let src = process.env.FFMPEG_MAC_DIR;
  if (!src) {
    src = path.join(VENDOR, '.ffmpeg-mac', spec.buildArch);
    if (!existsSync(path.join(src, 'ffmpeg'))) {
      const result = spawnSync(
        path.join(ROOT, 'scripts', 'build-ffmpeg-lgpl-mac.sh'),
        [spec.buildArch],
        { stdio: 'inherit' },
      );
      if (result.status !== 0) throw new Error('Building FFmpeg failed');
    }
  }
  for (const bin of ['ffmpeg', 'ffprobe']) {
    await fs.copyFile(path.join(src, bin), path.join(binDir, bin));
    await chmodX(path.join(binDir, bin));
  }
  // Every component's licence and the list of sources, already named
  // (FFmpeg-LICENSE.md, libvpx-PATENTS, SOURCES.txt…). Builds from before
  // the libraries were added have only FFmpeg's two, beside the binaries.
  const licenses = path.join(src, 'licenses');
  if (existsSync(licenses)) {
    for (const name of await fs.readdir(licenses)) {
      await fs.copyFile(
        path.join(licenses, name),
        path.join(binDir, 'licenses', name),
      );
    }
  } else {
    for (const license of ['LICENSE.md', 'COPYING.LGPLv2.1']) {
      if (existsSync(path.join(src, license))) {
        await fs.copyFile(
          path.join(src, license),
          path.join(binDir, 'licenses', `FFmpeg-${license}`),
        );
      }
    }
  }
  const versionFile = path.join(src, 'version.txt');
  versions.ffmpeg = {
    version: existsSync(versionFile)
      ? (await fs.readFile(versionFile, 'utf8')).trim()
      : null,
    source: 'built from source (LGPL)',
  };
}

async function fetchFfmpeg(target, spec, binDir, exe, versions) {
  if (spec.buildArch) return macFfmpeg(spec, binDir, versions);
  if (!/-lgpl[-.]/.test(spec.asset)) {
    throw new Error(`${spec.asset} is not an LGPL build; refusing to ship it`);
  }
  const sums = await fetchChecksums(
    gh('BtbN/FFmpeg-Builds', FFMPEG_TAG, 'checksums.sha256'),
  );
  const archive = path.join(CACHE, `${FFMPEG_TAG}-${spec.asset}`);
  await download(
    gh('BtbN/FFmpeg-Builds', FFMPEG_TAG, spec.asset),
    archive,
    FFMPEG_TAG === 'latest',
  );
  const sha256 = await verify(archive, sums.get(spec.asset), spec.asset);

  // Archives hold "<name>/bin/ffmpeg"; only ffmpeg and ffprobe are shipped.
  const tmp = path.join(CACHE, `x-${target}-ffmpeg`);
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });
  if (spec.asset.endsWith('.zip')) {
    await extractZip(archive, { dir: tmp });
  } else {
    // Node can't read xz; the system tar can.
    const result = spawnSync('tar', ['-xJf', archive, '-C', tmp], {
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error('tar extraction failed');
  }
  const [inner] = await fs.readdir(tmp);
  for (const bin of ['ffmpeg', 'ffprobe']) {
    const to = path.join(binDir, `${bin}${exe}`);
    await fs.copyFile(path.join(tmp, inner, 'bin', `${bin}${exe}`), to);
    await chmodX(to);
  }
  // LGPL requires shipping the license text with the binaries.
  const license = path.join(tmp, inner, 'LICENSE.txt');
  if (existsSync(license)) {
    await fs.copyFile(
      license,
      path.join(binDir, 'licenses', 'FFmpeg-LICENSE.txt'),
    );
  }
  await fs.rm(tmp, { recursive: true, force: true });
  versions.ffmpeg = {
    version: inner.match(/ffmpeg-n?([\d.]+)/)?.[1] ?? null,
    tag: FFMPEG_TAG,
    asset: spec.asset,
    sha256,
  };
}

/**
 * The app must only ever ship an LGPL FFmpeg; the GPL one is the user's
 * choice, installed from Settings. Binaries for this machine are run and
 * their build flags checked; for other targets the LGPL asset name has to do.
 */
function assertLgpl(target, binDir, exe) {
  if (target !== hostTarget()) return;
  const result = spawnSync(
    path.join(binDir, `ffmpeg${exe}`),
    ['-hide_banner', '-buildconf'],
    { encoding: 'utf8' },
  );
  const config = `${result.stdout}${result.stderr}`;
  if (result.status !== 0) throw new Error('The bundled ffmpeg does not run');
  if (/--enable-(gpl|nonfree)\b/.test(config)) {
    throw new Error('The bundled ffmpeg is a GPL or non-free build');
  }
  console.log('  ✓ ffmpeg is LGPL');
}

async function fetchTarget(target) {
  const spec = TARGETS[target];
  if (!spec) {
    throw new Error(
      `Unknown target "${target}". Known: ${Object.keys(TARGETS).join(', ')}`,
    );
  }
  console.log(`\n▶ ${target}`);
  const binDir = path.join(VENDOR, target, 'bin');
  await fs.rm(binDir, { recursive: true, force: true });
  await fs.mkdir(path.join(binDir, 'licenses'), { recursive: true });

  const versions = { target, fetchedAt: new Date().toISOString() };
  await fetchYtdlp(target, spec.ytdlp, binDir, spec.exe, versions);
  await fetchFfmpeg(target, spec.ffmpeg, binDir, spec.exe, versions);
  assertLgpl(target, binDir, spec.exe);
  await fs.writeFile(
    path.join(binDir, 'versions.json'),
    JSON.stringify(versions, null, 2),
  );
  console.log(`  → ${path.relative(ROOT, binDir)}`);
}

const args = process.argv.slice(2);
const targetArg = args
  .find((arg) => arg.startsWith('--target='))
  ?.split('=')[1];
const targets = args.includes('--all')
  ? Object.keys(TARGETS)
  : [targetArg || hostTarget()];

await fs.mkdir(CACHE, { recursive: true });
for (const target of targets) await fetchTarget(target);
console.log('\nDone.');
