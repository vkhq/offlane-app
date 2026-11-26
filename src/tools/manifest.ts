// What a tool's manifest.ts (and groups.ts) imports: icons and defineTool,
// and nothing else. The tool registry loads every manifest as it starts, so
// this must never reach the toolkit: ../ui re-exports components that import
// the registry back, and that loop breaks hot reloading ("Cannot access
// 'tools' before initialization").
export * from '../renderer/components/icons';
export { defineTool } from '../renderer/toolkit/types';
