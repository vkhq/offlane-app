// Makes every tool's Home card image: reads src/tools/<group>/<id>/
// banner.source.jpg (or .jpeg, .png, .webp) and writes banner.webp beside it.
//
//   npm run banners
//
// The card blurs the lower part of its banner so the text over it reads. A
// live backdrop blur on every card is costly to draw, so the blur is baked in
// here instead, matching what the card used to do in CSS:
//
// - the card shows the centre square of the image (object-cover), at most
//   206px across, so the banner is that square at 440px, sharp at 2x even
//   when a hovered card grows by 3%;
// - the blur was backdrop-blur-2xl, 40px on a 206px card, so sigma 85 here;
// - it covered the bottom three quarters of the card, solid over the lowest
//   45% of that and fading out above, as the fade-in-up mask did.
//
//
// The shade under the text is baked in too, over the blur. Rather than
// black, which turns light images a muddy grey, it is a deep tone of the
// image's own colour: the average of its lower half, kept in hue and taken
// down to a dark lightness. It rises like the CSS shade it replaces, 80%
// strong at the bottom, 50% halfway up the blurred part, clear at its top.
// Needs an ffmpeg with the libwebp encoder on PATH (Homebrew's has it; the
// vendored LGPL build does not).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const size = 440;
const sigma = 85;
// Rows from the top, in the 440px square: transparent above `fadeTop`,
// solid below `solidTop`, linear between.
const fadeTop = size * (1 - 0.75);
const solidTop = size * (1 - 0.75 * 0.45);
// The shade's colour: its lightness, and a cap on its saturation so a vivid
// image still gives a tone, not a neon.
const shadeLightness = 0.14;
const shadeSaturation = 0.55;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let encoders = '';
try {
  encoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  fail('ffmpeg was not found on PATH. Install it with `brew install ffmpeg`.');
}
if (!/\blibwebp\b/.test(encoders)) {
  fail('This ffmpeg cannot write WebP (no libwebp encoder).');
}

const square = `crop='min(iw,ih)':'min(iw,ih)',scale=${size}:${size}:flags=lanczos`;

/** The average colour of the lower half of the card's square, as [r, g, b]. */
const averageBelow = (source) => [
  ...execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      source,
      '-vf',
      `${square},crop=iw:ih/2:0:ih/2,scale=1:1:flags=area,format=rgb24`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  ),
];

/** A deep tone of a colour: its hue, capped saturation, dark lightness. */
const deepTone = (rgb) => {
  const [red, green, blue] = rgb.map((value) => value / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const chroma = max - min;
  // Hue in sixths of the wheel, 0 to 6.
  let hue = 0;
  if (chroma > 0 && max === red) hue = ((green - blue) / chroma + 6) % 6;
  else if (chroma > 0 && max === green) hue = (blue - red) / chroma + 2;
  else if (chroma > 0) hue = (red - green) / chroma + 4;
  const lightness = (max + min) / 2;
  const saturation =
    chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));

  // Back to RGB at the shade's lightness and capped saturation.
  const c =
    (1 - Math.abs(2 * shadeLightness - 1)) *
    Math.min(saturation, shadeSaturation);
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = shadeLightness - c / 2;
  const sectors = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  return sectors[Math.floor(hue) % 6].map((value) =>
    Math.round((value + m) * 255),
  );
};

// The shade's strength by row: t runs from 0 at the bottom to 1 at the top
// of the blurred part, 0.8 down to 0.5 over its lower half, to 0 above.
const shadeHeight = size * 0.75;
const t = `((${size}-Y)/${shadeHeight})`;
const shadeAlpha = `255*if(lt(${t},0.5),0.8-0.6*${t},max(0,1-${t}))`;

const filter = ([r, g, b]) =>
  [
    `[0]${square},split[sharp][soft]`,
    `[soft]gblur=sigma=${sigma},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip((Y-${fadeTop})/${solidTop - fadeTop},0,1)'[blurred]`,
    `[sharp][blurred]overlay=format=auto[soft-bottom]`,
    `color=c=black:s=${size}x${size},format=rgba,geq=r=${r}:g=${g}:b=${b}:a='${shadeAlpha}'[shade]`,
    `[soft-bottom][shade]overlay=format=auto,format=yuv420p`,
  ].join(';');

const root = 'src/tools';
let made = 0;
for (const group of readdirSync(root, { withFileTypes: true })) {
  if (!group.isDirectory()) continue;
  for (const tool of readdirSync(path.join(root, group.name), {
    withFileTypes: true,
  })) {
    if (!tool.isDirectory()) continue;
    const folder = path.join(root, group.name, tool.name);
    const source = ['jpg', 'jpeg', 'png', 'webp']
      .map((extension) => path.join(folder, `banner.source.${extension}`))
      .find((file) => existsSync(file));
    if (!source) continue;
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        source,
        '-filter_complex',
        filter(deepTone(averageBelow(source))),
        '-frames:v',
        '1',
        '-c:v',
        'libwebp',
        '-quality',
        '80',
        '-compression_level',
        '6',
        path.join(folder, 'banner.webp'),
      ],
      { stdio: 'inherit' },
    );
    made++;
  }
}
console.log(`Wrote ${made} banners.`);
