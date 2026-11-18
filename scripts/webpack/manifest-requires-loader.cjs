// The main process needs to know which toolkits each tool requires, so it
// can refuse to run a job whose toolkit is missing; the manifest says so in
// `requires`. But a manifest also imports the tool's icon, which is React,
// and React has no place in the main process. So, for the main build only,
// this loader reduces each src/tools/<group>/<id>/manifest.ts to its id and
// requires:
//
//   export default { id: "compress-video", requires: ["media"] };
//
// `requires` must therefore be a literal list of strings; anything else
// stops the build, rather than leaving a tool unchecked.
module.exports = function manifestRequires(source) {
  const id = /\bid:\s*(['"])([^'"]+)\1/.exec(source)?.[2];
  if (!id) {
    this.emitError(new Error(`${this.resourcePath}: no literal id`));
    return 'export default {};';
  }
  const list = /\brequires:\s*\[([^\]]*)\]/.exec(source);
  let requires = [];
  if (list) {
    const body = list[1].replace(/\/\/.*$/gm, '').trim();
    const items = body
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    requires = items.map((item) => /^(['"])([\w-]+)\1$/.exec(item)?.[2]);
    if (requires.some((item) => !item)) {
      this.emitError(
        new Error(
          `${this.resourcePath}: requires must be a list of quoted toolkit ids`,
        ),
      );
      requires = [];
    }
  } else if (/\brequires\s*:/.test(source)) {
    this.emitError(
      new Error(`${this.resourcePath}: requires must be a literal list`),
    );
  }
  return `export default ${JSON.stringify({ id, requires })};\n`;
};
