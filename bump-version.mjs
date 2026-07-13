#!/usr/bin/env node

/**
 * Synchronizes the PWA build markers used by the page and service worker.
 * Usage: npm run release:version -- 1.0.1 "Optional release note"
 */
import { readFile, writeFile } from 'node:fs/promises';

const nextVersion = process.argv[2];
const releaseNote = process.argv.slice(3).join(' ') || 'Neon Tank Arena update.';
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(nextVersion || '')) {
  console.error('Usage: npm run release:version -- <semver> [release note]');
  process.exitCode = 1;
} else {
  await synchronizeVersion(nextVersion, releaseNote);
}

/** Updates every deployable version marker as one release operation. */
async function synchronizeVersion(version, notes) {
  const today = new Date().toISOString().slice(0, 10);
  const versionJsPath = new URL('./public/version.js', import.meta.url);
  const versionJsonPath = new URL('./public/version.json', import.meta.url);
  const indexPath = new URL('./index.html', import.meta.url);

  const versionJs = (await readFile(versionJsPath, 'utf8'))
    .replace(/version: '[^']+'/, `version: '${version}'`)
    .replace(/publishedAt: '[^']+'/, `publishedAt: '${today}'`);
  await writeFile(versionJsPath, versionJs);

  const metadata = JSON.parse(await readFile(versionJsonPath, 'utf8'));
  metadata.version = version;
  metadata.publishedAt = today;
  metadata.notes = notes;
  await writeFile(versionJsonPath, `${JSON.stringify(metadata, null, 2)}\n`);

  const index = (await readFile(indexPath, 'utf8')).replace(
    /<meta name="app-version" content="[^"]+">/,
    `<meta name="app-version" content="${version}">`,
  );
  await writeFile(indexPath, index);

  console.log(`Neon Tank Arena version synchronized to ${version}.`);
  console.log('Deploy all assets first and version.json last.');
}
