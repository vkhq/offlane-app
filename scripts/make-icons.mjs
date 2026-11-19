// SPDX-License-Identifier: GPL-3.0-or-later
// Makes the app icons from assets/brand/logo.png and writes them beside it:
//
//   icon.icns  macOS. The logo sits at 824px in a 1024px canvas, as in
//              Apple's icon template, so it matches other apps in the Dock.
//   icon.ico   Windows, 16 to 256px, full size.
//   icon.png   Linux, 512px, full size.
//   icon-macos.png  the padded macOS icon as a PNG, for the Dock in
//              development (`npm start`), where there is no .icns.
//
//   npm run icons
//
// Runs on macOS only: it uses the system's sips and iconutil.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const brand = path.resolve('assets/brand');
const logo = path.join(brand, 'logo.png');
const work = mkdtempSync(path.join(tmpdir(), 'offlane-icons-'));

if (process.platform !== 'darwin') {
  console.error('npm run icons needs macOS (sips and iconutil).');
  process.exit(1);
}

const sips = (...args) => execFileSync('sips', args, { stdio: 'ignore' });

/** The logo scaled to `size` px square, written to `out`. */
const resized = (size, out) => {
  sips(
    '-s',
    'format',
    'png',
    '-z',
    String(size),
    String(size),
    logo,
    '--out',
    out,
  );
  return out;
};

// macOS: the 824px logo centred on a transparent 1024px canvas, then every
// size iconutil expects, made from that.
const body = resized(824, path.join(work, 'body.png'));
const canvas = path.join(work, 'canvas.png');
sips('-p', '1024', '1024', body, '--out', canvas);
copyFileSync(canvas, path.join(brand, 'icon-macos.png'));
const iconset = path.join(work, 'icon.iconset');
execFileSync('mkdir', [iconset]);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
    const out = path.join(iconset, name);
    sips(
      '-z',
      String(size * scale),
      String(size * scale),
      canvas,
      '--out',
      out,
    );
  }
}
execFileSync('iconutil', [
  '-c',
  'icns',
  iconset,
  '-o',
  path.join(brand, 'icon.icns'),
]);

// Windows: an .ico holding PNG images, which Windows Vista and later read.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) =>
  readFileSync(resized(size, path.join(work, `ico-${size}.png`))),
);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
const entries = Buffer.alloc(16 * images.length);
let offset = header.length + entries.length;
images.forEach((image, at) => {
  const size = sizes[at];
  const entry = at * 16;
  // 256 is written as 0, as the format requires.
  entries.writeUInt8(size === 256 ? 0 : size, entry);
  entries.writeUInt8(size === 256 ? 0 : size, entry + 1);
  entries.writeUInt8(0, entry + 2);
  entries.writeUInt8(0, entry + 3);
  entries.writeUInt16LE(1, entry + 4);
  entries.writeUInt16LE(32, entry + 6);
  entries.writeUInt32LE(image.length, entry + 8);
  entries.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
writeFileSync(
  path.join(brand, 'icon.ico'),
  Buffer.concat([header, entries, ...images]),
);

// Linux.
resized(512, path.join(brand, 'icon.png'));

rmSync(work, { recursive: true, force: true });
console.log(
  'Wrote assets/brand/icon.icns, icon.ico, icon.png and icon-macos.png.',
);
