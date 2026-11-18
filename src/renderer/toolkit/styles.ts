// Classes the toolkit's parts share, so every tool's form reads as one
// system: compact, and with no fills except where they say something (a
// field at rest, the main button).

/** A row's icon: bare, with no tile behind it. */
export const tile = 'grid size-5 shrink-0 place-items-center text-ink-faint';
export const row = 'flex h-10 items-center gap-3';
export const rowLabel = 'flex-1 truncate text-[13px] font-medium';
export const zone =
  'flex w-full flex-col items-center rounded-xl px-6 py-5 text-center';
/** A quiet text button: Browse, Clear, Start Over, Show in Finder. */
export const smallButton =
  'inline-flex h-6.5 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-[12px] font-medium text-ink-soft hover:bg-ink/5 hover:text-ink';
export const softButton = smallButton;
/** The one button that moves the workflow on: Go, Download, Compress. */
export const goButton =
  'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-ink px-2.5 text-[12px] font-semibold text-canvas hover:opacity-90 disabled:cursor-default disabled:bg-transparent disabled:text-ink-faint disabled:hover:opacity-100';
export const iconButton =
  'grid size-6.5 shrink-0 cursor-pointer place-items-center rounded-md text-ink-faint hover:bg-ink/5 hover:text-ink';
