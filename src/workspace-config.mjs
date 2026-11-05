// Both hosts share this data location unless the user explicitly overrides it.
export const DEFAULT_WORKSPACE = String.raw`D:\AI-Workspace\apps\writer-workbench`;

export function resolveWorkspaceSetting(explicit, environment = process.env.WORKBENCH_WORKSPACE) {
  for (const value of [explicit, environment]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return DEFAULT_WORKSPACE;
}
