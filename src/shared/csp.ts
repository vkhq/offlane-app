/**
 * The page's Content Security Policy. Everything it loads comes from the app
 * itself, and nothing runs from a string. Styles may be inline: style-loader
 * adds the CSS as <style> tags, and React sets style attributes.
 * Sent by the dev server (see forge.config.mts) and by the app:// protocol
 * once packaged (see the main process).
 */
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  // Finished downloads, for the in-app player (see main/player.ts).
  "media-src 'self' media:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
