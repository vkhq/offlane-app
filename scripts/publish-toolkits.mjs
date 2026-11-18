#!/usr/bin/env node
// Publishes toolkits: packs what `npm run fetch-binaries` put in
// vendor/<os>-<arch>/bin into one archive per toolkit, and records where
// they will be hosted, with their SHA-256 and size, for the app to
// download (see src/main/toolkits).
//
//   node scripts/publish-toolkits.mjs --base-url=https://example.com/toolkits/
//   node scripts/publish-toolkits.mjs --base-url=… --target=mac-arm64
//   node scripts/publish-toolkits.mjs --keygen     # a new feed signing key
//
// It writes, under out/toolkits/:
//   <toolkit>-<variant>-<version>-<target>.zip   to upload to --base-url
//   toolkits.json (+ .sig)                       the signed update feed
// and rewrites src/main/toolkits/published.ts, which the next build of the
// app pins. Uploading is left to you: copy out/toolkits/ to --base-url.
//
// Optional, from the environment:
//   APPLE_SIGNING_IDENTITY   macOS: sign every program with the hardened
//                            runtime before packing, so Gatekeeper accepts it
//   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
//                            macOS: also notarize each archive
//   TOOLKITS_SIGNING_KEY     path to the Ed25519 private key (PEM) that
//                            signs toolkits.json; without it the feed is
//                            written unsigned and the app ignores it
import { spawnSync } from 'node:child_process';
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');
const OUT = path.join(ROOT, 'out', 'toolkits');
const PUBLISHED = path.join(ROOT, 'src', 'main', 'toolkits', 'published.ts');

const args = process.argv.slice(2);
const option = (name) =>
  args
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');

if (args.includes('--keygen')) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  await fs.mkdir(OUT, { recursive: true });
  const file = path.join(OUT, 'feed-signing-key.pem');
  await fs.writeFile(
    file,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  );
  console.log(`Private key: ${file}  (keep it secret; not for the repo)`);
  console.log('Public key, for FEED.publicKey in src/main/toolkits/feed.ts:');
  console.log(publicKey.export({ type: 'spki', format: 'pem' }));
  process.exit(0);
}

const baseUrl = option('base-url');
if (!baseUrl || !baseUrl.startsWith('https://')) {
  console.error(
    'Give --base-url=https://… : where out/toolkits/ will be uploaded.',
  );
  process.exit(1);
}
const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

const targets = option('target')
  ? [option('target')]
  : (await fs.readdir(VENDOR).catch(() => [])).filter((name) =>
      existsSync(path.join(VENDOR, name, 'bin', 'versions.json')),
    );
if (targets.length === 0) {
  console.error(
    'Nothing in vendor/ to publish. Run npm run fetch-binaries first.',
  );
  process.exit(1);
}

const sha256File = async (file) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

const exe = (target, name) =>
  target.startsWith('win-') ? `${name}.exe` : name;

/** Runs a command, stopping the script if it fails. */
function sh(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed`);
  }
}

/** Signs every Mach-O program under `dir` with the hardened runtime. */
function codesign(dir, files) {
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  if (!identity || process.platform !== 'darwin') return;
  for (const file of files) {
    sh('codesign', [
      '--force',
      '--timestamp',
      '--options',
      'runtime',
      '--entitlements',
      path.join(ROOT, 'build', 'entitlements.mac.inherit.plist'),
      '--sign',
      identity,
      path.join(dir, file),
    ]);
  }
}

/** Submits an archive to Apple's notary service and waits for it. */
function notarize(archive) {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) return;
  if (!process.env.APPLE_SIGNING_IDENTITY || process.platform !== 'darwin')
    return;
  sh('xcrun', [
    'notarytool',
    'submit',
    archive,
    '--apple-id',
    APPLE_ID,
    '--password',
    APPLE_APP_SPECIFIC_PASSWORD,
    '--team-id',
    APPLE_TEAM_ID,
    '--wait',
  ]);
}

/**
 * Copies `files` (paths inside the bin folder, with where each goes) into a
 * fresh folder and zips it, keeping links (a bundled Python.framework has
 * them). Resolves with the archive's entry for the catalog.
 */
async function pack(name, binDir, files, programs) {
  const stage = path.join(OUT, '.stage', name);
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });
  for (const [from, to] of files) {
    const source = path.join(binDir, from);
    if (!existsSync(source)) continue;
    await fs.mkdir(path.dirname(path.join(stage, to)), { recursive: true });
    await fs.cp(source, path.join(stage, to), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
  codesign(stage, programs);
  const archive = path.join(OUT, `${name}.zip`);
  await fs.rm(archive, { force: true });
  sh('zip', ['-qry', archive, '.'], { cwd: stage });
  notarize(archive);
  await fs.rm(stage, { recursive: true, force: true });
  const { size } = await fs.stat(archive);
  console.log(`  ✓ ${path.basename(archive)} (${(size / 1e6).toFixed(1)} MB)`);
  return {
    url: new URL(path.basename(archive), base).toString(),
    sha256: await sha256File(archive),
    size,
  };
}

const safe = (text) => String(text).replace(/[^\w.-]/g, '_');

/** The releases for one target, by toolkit and variant. */
async function publishTarget(target) {
  console.log(`\n▶ ${target}`);
  const binDir = path.join(VENDOR, target, 'bin');
  const versions = JSON.parse(
    await fs.readFile(path.join(binDir, 'versions.json'), 'utf8'),
  );
  const releases = {};

  // yt-dlp in vendor/ is for tests only: the app never ships or downloads
  // it (see src/shared/externalTools.ts), so it isn't published.

  // Media: the LGPL FFmpeg and FFprobe, with their licence.
  if (existsSync(path.join(binDir, exe(target, 'ffmpeg')))) {
    const licenses = (
      await fs.readdir(path.join(binDir, 'licenses')).catch(() => [])
    )
      .filter((name) => name.startsWith('FFmpeg-'))
      .map((name) => [`licenses/${name}`, `licenses/${name}`]);
    const version = versions.ffmpeg?.version ?? 'unknown';
    const archive = await pack(
      `media-lgpl-${safe(version)}-${target}`,
      binDir,
      [
        [exe(target, 'ffmpeg'), exe(target, 'ffmpeg')],
        [exe(target, 'ffprobe'), exe(target, 'ffprobe')],
        ...licenses,
      ],
      [exe(target, 'ffmpeg'), exe(target, 'ffprobe')],
    );
    releases.media = {
      lgpl: {
        version,
        host: new URL(base).host,
        archives: [archive],
        binaries: {
          ffmpeg: exe(target, 'ffmpeg'),
          ffprobe: exe(target, 'ffprobe'),
        },
        checks: [
          {
            binary: 'ffmpeg',
            args: ['-hide_banner', '-buildconf'],
            forbid: '--enable-(gpl|nonfree)\\b',
            message: 'The downloaded FFmpeg isn’t the standard (LGPL) build.',
          },
          { binary: 'ffprobe', args: ['-version'], expect: '^ffprobe version' },
        ],
      },
    };
  }
  return releases;
}

/** What published.ts already holds, so other targets are kept. */
async function readPublished() {
  try {
    const text = await fs.readFile(PUBLISHED, 'utf8');
    const json = text.slice(text.indexOf('= {') + 2, text.lastIndexOf(';'));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

await fs.mkdir(OUT, { recursive: true });
const overlay = await readPublished();
for (const target of targets) {
  const releases = await publishTarget(target);
  for (const [id, variants] of Object.entries(releases)) {
    for (const [variant, release] of Object.entries(variants)) {
      ((overlay[id] ??= {})[variant] ??= {})[target] = release;
    }
  }
}

await fs.writeFile(
  PUBLISHED,
  `// Toolkit builds this project publishes itself, by toolkit, variant and
// target. Written by \`npm run publish-toolkits -- --base-url=<where they are
// hosted>\`; edit by running it again, not by hand.
import type { ReleaseOverlay } from './catalog';

export const published: ReleaseOverlay = ${JSON.stringify(overlay, null, 2)};
`,
);
console.log(`\n→ ${path.relative(ROOT, PUBLISHED)}`);

// The feed: the same releases, signed, for apps already installed.
const feed = Buffer.from(
  JSON.stringify(
    { publishedAt: new Date().toISOString(), toolkits: overlay },
    null,
    2,
  ),
);
await fs.writeFile(path.join(OUT, 'toolkits.json'), feed);
const keyFile = process.env.TOOLKITS_SIGNING_KEY;
if (keyFile) {
  const key = createPrivateKey(await fs.readFile(keyFile));
  await fs.writeFile(
    path.join(OUT, 'toolkits.json.sig'),
    sign(null, feed, key).toString('base64'),
  );
  console.log('→ out/toolkits/toolkits.json (signed)');
} else {
  console.log(
    '→ out/toolkits/toolkits.json (unsigned: set TOOLKITS_SIGNING_KEY to sign it)',
  );
}
console.log(`\nUpload out/toolkits/*.zip and toolkits.json(.sig) to ${base}`);
