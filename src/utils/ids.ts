export function newId(prefix: string) {
  // simple unique ID (good enough for MVP)
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
