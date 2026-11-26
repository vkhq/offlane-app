// Starts a new tool: writes src/tools/<group>/<id>/ with a manifest, options
// and a standard page, which is all the app needs to list and open it.
//
//   npm run new-tool -- <group> <id> "<Name>" [--handler]
//
// --handler also writes a handler.ts, the tool's back end. For a card image
// on Home, add a banner.source.jpg beside the manifest, run `npm run banners`
// to make banner.webp from it, and import banner.webp in the manifest.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [group, id, name] = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith('--'));
const withHandler = process.argv.includes('--handler');

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (!group || !id || !name) {
  fail('Usage: npm run new-tool -- <group> <id> "<Name>" [--handler]');
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
  fail(`The id "${id}" should be lowercase words joined by hyphens.`);
}
const groups = readFileSync('src/tools/groups.ts', 'utf8');
if (!groups.includes(`id: '${group}'`)) {
  fail(`"${group}" is not a group in src/tools/groups.ts. Add it there first.`);
}
const dir = path.join('src/tools', group, id);
if (existsSync(dir)) fail(`${dir} already exists.`);
mkdirSync(dir, { recursive: true });

// Every new source file says its licence; older files gain the line over time.
// REUSE-IgnoreStart
const spdx = '// SPDX-License-Identifier: GPL-3.0-or-later\n';
// REUSE-IgnoreEnd
const write = (file, text) => writeFileSync(path.join(dir, file), spdx + text);

write(
  'manifest.ts',
  `import { WandSparkles, defineTool } from '../../manifest';

export default defineTool({
  id: '${id}',
  name: '${name}',
  description: 'What ${name} does, in one sentence.',
  icon: WandSparkles,
});
`,
);

write(
  'options.ts',
  `import { defineOptions, select } from '../../options';

export const options = defineOptions({
  format: select('Format', ['MP4', 'MOV']),
});
`,
);

write(
  'page.tsx',
  `import { dropFiles, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropFiles(),
  options,
  action: '${name}',
});
`,
);

if (withHandler) {
  write(
    'handler.ts',
    `import { defineHandler } from '../../backend';
import { options } from './options';

export default defineHandler({
  options,
  async run(context) {
    const output = context.outputPath('-done', context.values.format.toLowerCase());
    // Do the work here, e.g. with runFfmpeg from ../../backend, writing to
    // \`output\` and reporting context.progress(percent) as it goes.
    throw new Error(\`${name} has no back end yet (would write \${output}).\`);
  },
});
`,
  );
}

console.log(
  `Wrote ${dir}. It shows up in the sidebar, Home and search once the app reloads.`,
);
