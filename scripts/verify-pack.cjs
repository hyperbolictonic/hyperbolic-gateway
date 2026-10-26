/**
 * afterPack: fail the build if a critical runtime dependency or native binary is missing from
 * app.asar / app.asar.unpacked. The installed app must be able to start and open Cortex without
 * a Node/Bun installation.
 */
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { Arch } = require('builder-util');

const platform = (context) => context.electronPlatformName || process.platform;
const arch = (context) => Arch[context.arch] || process.arch;

function resourcesDir(context) {
  if ((context.electronPlatformName || process.platform) === 'darwin') {
    return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
  }
  return path.join(context.appOutDir, 'resources');
}

function nativePackages(platformName, archName) {
  const lancedb = {
    win32: `@lancedb/lancedb-win32-${archName}-msvc`,
    darwin: `@lancedb/lancedb-darwin-${archName}`,
    linux: `@lancedb/lancedb-linux-${archName}-gnu`,
  }[platformName];
  const sharp = `@img/sharp-${platformName}-${archName}`;
  const libvips = `@img/sharp-libvips-${platformName}-${archName}`;
  return { lancedb, sharp, libvips };
}

module.exports = async function afterPack(context) {
  const platformName = platform(context);
  const archName = arch(context);
  const resources = resourcesDir(context);
  const appAsar = path.join(resources, 'app.asar');
  const unpacked = path.join(resources, 'app.asar.unpacked');

  if (!fs.existsSync(appAsar)) throw new Error(`[afterPack] app.asar missing at ${appAsar}`);

  const entries = new Set(
    asar.listPackage(appAsar).map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, ''))
  );
  const requiredJs = [
    'node_modules/apache-arrow/package.json',
    'node_modules/@opentelemetry/api/package.json',
    'node_modules/reflect-metadata/package.json',
    'node_modules/@lancedb/lancedb/package.json',
    'node_modules/@huggingface/transformers/package.json',
    'node_modules/onnxruntime-node/package.json',
    'node_modules/sharp/package.json',
    'node_modules/@modelcontextprotocol/sdk/package.json',
    'node_modules/jsdom/package.json',
  ];
  const missing = requiredJs.filter((entry) => !entries.has(entry));

  const native = nativePackages(platformName, archName);
  const requiredUnpacked = [
    'bin/mcp-server.cjs',
    'bin/wrap-server.cjs',
    path.join('node_modules', native.lancedb),
    path.join('node_modules', native.sharp),
    path.join('node_modules', 'onnxruntime-node', 'bin', 'napi-v6', platformName, archName),
  ];
  // Windows sharp bundles libvips inside sharp-win32-*; macOS/Linux use a separate libvips package.
  if (platformName !== 'win32') {
    requiredUnpacked.push(path.join('node_modules', native.libvips));
  }
  for (const entry of requiredUnpacked) {
    if (!fs.existsSync(path.join(unpacked, entry))) missing.push(`unpacked:${entry}`);
  }

  if (missing.length) {
    throw new Error(
      `[afterPack] missing packaged runtime files for ${platformName}/${archName}:\n  ${missing.join('\n  ')}`
    );
  }

  console.log(
    `[afterPack] verified ${requiredJs.length} JS runtimes + ${requiredUnpacked.length} unpacked native/bin paths for ${platformName}/${archName}`
  );
};
