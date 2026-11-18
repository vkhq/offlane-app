export const isMac = navigator.platform.startsWith('Mac');

/** Cmd on a Mac; Ctrl stands in for it on Windows and Linux. */
export const hasModifier = (event: { metaKey: boolean; ctrlKey: boolean }) =>
  isMac ? event.metaKey : event.ctrlKey;
