import type { CSSProperties } from 'react';

import type { Tool } from '../tools';

/** A number from the id alone (FNV-1a), the same on every launch. */
function hash(id: string) {
  let value = 0x811c9dc5;
  for (let at = 0; at < id.length; at += 1) {
    value = Math.imul(value ^ id.charCodeAt(at), 0x01000193);
  }
  return value >>> 0;
}

/**
 * Each tool gets its own colours, picked from its id, so adding or moving
 * other tools never changes them. `--band` is a very light tint; the other
 * two are a vivid pair for gradients. They are data, set as custom
 * properties for classes to read.
 */
export function toolColors(tool: Tool) {
  const hue = hash(tool.id) % 360;
  return {
    '--band': `hsl(${hue} 70% 97%)`,
    '--gradient-from': `hsl(${hue} 100% 40%)`,
    '--gradient-to': `hsl(${(hue + 84) % 360} 100% 50%)`,
  } as CSSProperties;
}
