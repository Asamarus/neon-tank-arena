/**
 * Neon Tank Arena build metadata.
 *
 * Update this one version value for every deployment. Both the page and the
 * classic service worker load this file, so a changed version.js also causes
 * the browser's service-worker update algorithm to detect a new build.
 */
globalThis.NTA_BUILD = Object.freeze({
  version: '1.0.0',
  publishedAt: '2026-07-14',
  cachePrefix: 'neon-tank-arena',

  // Public GitHub Pages deployment marker used for online update checks.
  remoteVersionUrl: 'https://asamarus.github.io/neon-tank-arena/version.json',
  localVersionUrl: './version.json',

  // Recheck while the game remains open, and also whenever connectivity returns.
  updateIntervalMs: 6 * 60 * 60 * 1000,
})
