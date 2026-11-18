# Tools

Each tool is one folder, `src/tools/<group>/<tool-id>/`. The app finds it on its
own, so adding a tool never means editing a shared list.

```
src/tools/video/compress-video/
  manifest.ts        name, description, icon, banner: what the sidebar, Home and search show
  options.ts         its options, by key, shared by the page and the handler
  page.tsx           its page: usually `standardTool({...})`, or a component of its own
  handler.ts         its back end, run in the main process (optional)
  banner.source.jpg  its card image on Home, full size (optional)
  banner.webp        made from it by `npm run banners`; the manifest imports this
```

Start one with:

```sh
npm run new-tool -- <group> <tool-id> "<Name>" [--handler]
```

## The rules

- **A tool imports only from its own folder and from `../../ui` (pages,
  manifest), `../../options` (options) or `../../backend` (handler).** It never
  imports from another tool, and the app never imports a tool's folder. Lint
  enforces both (see `.oxlintrc.json`). Anything two tools need goes into the
  toolkit (`src/renderer/toolkit`, or `src/tools/backend.ts`).
- **The folder's name is the tool's id and its route** (`/compress-video`).
  The group is the parent folder, which must be listed in `groups.ts`.
- **Options are read by key, never by label** (`values.quality`). Labels and
  order can change freely; a tab keeps its values across such changes.
- **A broken tool is left out, not fatal.** A manifest with the wrong id, an
  unknown group or no page logs an error in the console and the rest still load.

## Pages

`standardTool({ input, options, action })` gives the usual page: files (from
`dropVideos()`, `dropPdfs()` and so on), a link or a recording, then the
options, Clear and the action button, with the results listed under it. A tool
that needs a different page writes its own component from the same parts
(`ToolLayout`, `DropZone`, `LinkField`, `OptionsForm`, `ActionBar`,
`JobList`); see `video/download-video/page.tsx`.

Pages load the first time they are needed, or in the background once the app
is idle, so startup only loads the manifests.

## Handlers

A `handler.ts` exports `defineHandler({ options, run })`. `run` gets one input
at a time with checked values, and a context with `outputPath()`, `progress()`,
`signal`, `ffmpeg()` and `run()` (spawns a program with an argv array, never a
shell). Helpers like `probeMedia` and `runFfmpeg` are in `backend.ts`. The
queue runs a few jobs at once, and deletes the outputs of a job that fails or
is cancelled. A tool without a handler says "isn't connected yet" when run.

Download Video is the exception: it keeps its own download manager
(`src/main/downloads`), which handles probing, playlists, pause and resume.
