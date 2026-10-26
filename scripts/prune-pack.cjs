/**
 * Keep only the native runtimes for the platform/arch being packaged.
 *
 * Run this BEFORE electron-builder: its dependency collector captures the file tree early, so
 * pruning inside beforePack is too late. CI runs this in the packaging job; local builds use
 * `npm run prune:pack` with TARGET_PLATFORM/TARGET_ARCH (win32/darwin/linux, x64/arm64).
 *
 * Why: pnpm/hoisted and LanceDB's optional embedding stack otherwise drag every platform's
 * ONNX/sharp binaries and the Hugging Face model cache into app.asar (>1 GB).
 */
const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');

const PLATFORMS = { win: 'win32', mac: 'darwin', linux: 'linux' };

const rm = (target) => fs.rmSync(target, { recursive: true, force: true });

/** Delete every `.cache` directory below root (Hugging Face model weights, build caches). */
function removeCaches(root) {
  if (!fs.existsSync(root)) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (entry.name === '.cache') {
      rm(full);
      continue;
    }
    removeCaches(full);
  }
}

function normalizeArch(value) {
  if (typeof value === 'number') return Arch[value] || process.arch;
  return String(value || process.arch);
}

function pruneNative(platform, arch) {
  const nm = path.join(process.cwd(), 'node_modules');
  const log = (message) => console.log(`[prune-pack] ${message}`);

  // LanceDB's optional embedding stack (transformers/onnx/sharp/openai) is not used by Kuang's
  // Cortex path, and it nests a second multi-platform copy under the package.
  const nested = path.join(nm, '@lancedb', 'lancedb', 'node_modules');
  rm(nested);

  // Never ship a downloaded model cache from the build machine.
  rm(path.join(nm, '@huggingface', 'transformers', '.cache'));
  removeCaches(path.join(nm, '.pnpm'));
  rm(path.join(nm, '.cache'));

  // Keep only the target OS/arch under onnxruntime-node (top-level and pnpm store copies).
  const pruneOnnx = (base) => {
    const ort = path.join(base, 'bin', 'napi-v6');
    if (!fs.existsSync(ort)) return;
    for (const entry of fs.readdirSync(ort)) {
      const full = path.join(ort, entry);
      if (!fs.statSync(full).isDirectory()) continue;
      if (entry !== platform) {
        rm(full);
        continue;
      }
      for (const a of fs.readdirSync(full)) {
        if (a !== arch) rm(path.join(full, a));
      }
    }
  };
  pruneOnnx(path.join(nm, 'onnxruntime-node'));

  const pnpm = path.join(nm, '.pnpm');
  if (fs.existsSync(pnpm)) {
    for (const entry of fs.readdirSync(pnpm)) {
      const mods = path.join(pnpm, entry, 'node_modules');
      if (!fs.existsSync(mods)) continue;

      // LanceDB's optional embedding generation (v3 transformers) is not used by the app.
      if (entry.startsWith('@huggingface+transformers@3.0.2') || entry.startsWith('onnxruntime-node@1.19.2')) {
        rm(path.join(pnpm, entry));
        continue;
      }

      // The published LanceDB package also embeds its own node_modules copy in pnpm's store.
      const nestedLance = path.join(mods, '@lancedb', 'lancedb', 'node_modules');
      if (fs.existsSync(nestedLance)) rm(nestedLance);

      if (entry.startsWith('onnxruntime-node@')) pruneOnnx(path.join(mods, 'onnxruntime-node'));
      if (entry.startsWith('@lancedb+lancedb@')) {
        for (const name of ['@huggingface', 'onnxruntime-node', 'sharp', '@img', 'openai']) {
          rm(path.join(mods, name));
        }
      }
    }
  }

  // Keep only the target LanceDB native package.
  const lancedb = path.join(nm, '@lancedb');
  if (fs.existsSync(lancedb)) {
    const keep = {
      win32: `lancedb-win32-${arch}-msvc`,
      darwin: `lancedb-darwin-${arch}`,
      linux: `lancedb-linux-${arch}-gnu`,
    }[platform];
    for (const entry of fs.readdirSync(lancedb)) {
      if (entry === 'lancedb' || entry === keep) continue;
      if (/^lancedb-(win32|darwin|linux)-/.test(entry)) rm(path.join(lancedb, entry));
    }
  }

  // Keep only the target sharp/libvips binaries.
  const img = path.join(nm, '@img');
  if (fs.existsSync(img)) {
    for (const entry of fs.readdirSync(img)) {
      if (!/^(sharp|sharp-libvips)-/.test(entry)) continue;
      if (entry.includes(`${platform}-${arch}`)) continue;
      rm(path.join(img, entry));
    }
  }

  log(`kept native runtimes for ${platform}/${arch}`);
}

module.exports = async function beforePack(context) {
  pruneNative(context.electronPlatformName || process.platform, normalizeArch(context.arch));
};

if (require.main === module) {
  const platformArg = process.env.TARGET_PLATFORM || process.argv[2] || process.platform;
  const archArg = process.env.TARGET_ARCH || process.argv[3] || process.arch;
  const platform = PLATFORMS[platformArg] || platformArg;
  pruneNative(platform, normalizeArch(archArg));
}
