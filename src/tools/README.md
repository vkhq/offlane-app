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

`standardTool({ input, options, action })` gives the usual page, and a tool
should need nothing else. A new tool is its manifest, options, a one-line page
and a handler; everything below comes with `standardTool`, the same on its own
page and when it is used as a later step, so never rebuild any of it:

- **Input:** files (from `dropVideos()`, `dropPdfs()` and so on), a link or a
  recording; locked once it has run, until Start Over. Videos, dropped,
  picked or made by an earlier stage, show the same way everywhere
  (`MediaStrip`): a strip of frames with their lengths, and their sizes
  where the tool is about size (`withSizes(dropVideos())`, as Compress). Dropped
  or picked ones sit under the drop zone, which stays to add more, each
  with a ✕ to take it out; an earlier stage's have a checkbox to run on
  it or not.
- **Editor (optional):** `editor: TrimEditor` shows the file in an editor
  in place of the strip, to set options by hand, and makes the tool work on
  one file at a time (on a later step, its checkboxes pick one). Trim
  Video's sets Start and End on a timeline of the video's frames
  (`TrimEditor`); an editor gets the file as a `MediaRef` and plays it,
  and asks for its frames (or a waveform), through `window.media`. A tool
  with an editor gets a wider column. A value only the editor sets (a crop box's edges) is an
  `editorValue('Left', 0)` option: whole pixels of the picture as it plays,
  sent to the handler but never in the options bar or the summary. The
  handler keeps it within the picture, as the file may not be the one it
  was set on.
- **Options:** a "<Tool> Options" chip on the link to them, the menu bar of
  options, and the button, counting what it runs on ("Mute 2 Videos"); kept
  as a read-only record once run (`RunSection`).
- **Results:** a link saying how they are going, then what was made ("2
  Videos Muted"), and a card for each run (`Results`, `ResultCard`): its
  picture (a frame, the picture itself, an album's cover, or the thumbnail
  of the video it was downloaded as), its length, name and size, progress,
  Cancel, Play in the app's player for video and audio, and a menu (Open,
  Show in Finder, Remove).
- **What's Next:** among several results a chip on each card, and once none
  is under way the What's Next? button for all of them; picking a tool adds
  it as a step branching below that stage, with checkboxes to choose which
  files it runs on. Every stage keeps its What's Next?, so a stage can
  branch into several tools, side by side.
- **Canvas:** the page is a canvas (`Canvas`) that pans with two fingers
  on a trackpad, the wheel, or by dragging an empty part (or anywhere with
  Space held), and zooms with a pinch or its corner buttons. It pans only
  once the stages are bigger than the window. A page that wants something
  in view calls `useCanvas()?.reveal(element)` rather than scrolling.
- **History, tabs and restarts:** the page's state is kept with its tab and
  in History, and its results are still listed after the app restarts.

How these look and behave is changed in one place, in
`src/renderer/toolkit`, and every tool follows.

A tool that needs a page of its own (as Download Video does, for its lookup
and download manager) builds it from the same parts: `ToolLayout`,
`DropZone`, `LinkField`, `OptionsBar`, and `Results` with `ResultCard` for
its results, so they look and act like every other tool's. See
`video/download-video/page.tsx`.

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
