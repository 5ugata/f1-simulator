// Vite replaces BASE_URL for production. The fallback also lets the physics
// tests import track.js directly in Node, outside Vite's module transform.
export function publicAsset(path) {
  return `${import.meta.env?.BASE_URL ?? '/'}${path.replace(/^\/+/, '')}`;
}
