import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import archiver from 'archiver';
import {
  resolveBuildProfile,
  discoverPatchEntryFiles,
  patchRegistryPlugin,
} from './patch-discovery.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const requestedProfile = process.argv[2] || process.env.BUILD_PROFILE || 'public';
const profile = resolveBuildProfile(requestedProfile);
const outDir = path.join(rootDir, 'dist', profile);

function resolveConfiguredApiServerUrl() {
  let envFileUrl = '';
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = /^(?:VITE_)?MONKEYBRAIN_API_URL\s*=\s*(.+)$/.exec(line);
      if (match) {
        envFileUrl = match[1].trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }
  const raw =
    process.env.MONKEYBRAIN_API_URL ||
    process.env.VITE_MONKEYBRAIN_API_URL ||
    envFileUrl ||
    'https://stash.monkeybrain.cc';
  return raw.replace(/\/+$/, '');
}

const configuredApiUrl = resolveConfiguredApiServerUrl();

console.log(`==========================================================`);
console.log(`  Building MonkeyPatch Extension — Profile: [${profile.toUpperCase()}]`);
console.log(`  API Server: ${configuredApiUrl}`);
console.log(`==========================================================`);

// 1. Clean output directory
if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}
fs.mkdirSync(outDir, { recursive: true });

const discoveredPatches = discoverPatchEntryFiles(profile);
console.log(`Discovered ${discoveredPatches.length} patch(es) for [${profile}] profile:`);
for (const p of discoveredPatches) {
  console.log(`  - ${path.relative(rootDir, p)}`);
}

// 2. Build Popup UI (HTML + React)
console.log('\n[1/4] Building Popup UI...');
await build({
  configFile: false,
  root: rootDir,
  base: './',
  define: {
    __MONKEYBRAIN_API_URL__: JSON.stringify(configuredApiUrl),
  },
  plugins: [react(), patchRegistryPlugin(profile)],
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: path.join(rootDir, 'popup.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});

// 3. Build Background Service Worker (Self-contained ES module)
console.log('\n[2/4] Building Background Service Worker...');
await build({
  configFile: false,
  root: rootDir,
  define: {
    __MONKEYBRAIN_API_URL__: JSON.stringify(configuredApiUrl),
  },
  plugins: [patchRegistryPlugin(profile)],
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: path.join(rootDir, 'src', 'background', 'index.ts'),
      formats: ['es'],
      fileName: () => 'background.js',
    },
  },
});

// 4. Build Content Script (Self-contained IIFE bundle for Chrome MV3 content_scripts)
console.log('\n[3/4] Building Content Script & Bundling Discovered Patches...');
await build({
  configFile: false,
  root: rootDir,
  define: {
    __MONKEYBRAIN_API_URL__: JSON.stringify(configuredApiUrl),
  },
  plugins: [patchRegistryPlugin(profile)],
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: path.join(rootDir, 'src', 'content', 'index.ts'),
      name: 'MonkeyPatchContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});

// 5. Copy icons and generate Profile-Specific manifest.json
console.log('\n[4/4] Copying icons & generating manifest.json...');
const iconsSrcDir = path.join(rootDir, 'icons');
const iconsOutDir = path.join(outDir, 'icons');
if (fs.existsSync(iconsSrcDir)) {
  fs.mkdirSync(iconsOutDir, { recursive: true });
  for (const file of fs.readdirSync(iconsSrcDir)) {
    fs.copyFileSync(path.join(iconsSrcDir, file), path.join(iconsOutDir, file));
  }
}
const baseManifest = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf-8')
);
const pkgJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')
);

baseManifest.version = pkgJson.version || baseManifest.version;

try {
  const parsedApiOrigin = new URL(configuredApiUrl).origin;
  const hostPerms = new Set(baseManifest.host_permissions || []);
  hostPerms.add(`${parsedApiOrigin}/*`);
  baseManifest.host_permissions = Array.from(hostPerms);
} catch {
  // Ignore invalid URL in manifest host_permissions injection
}

if (profile === 'personal') {
  baseManifest.name = `${baseManifest.name} (Personal)`;
  const extraHosts = new Set([
    ...(baseManifest.host_permissions || []),
    'https://*/*',
    'http://*/*',
  ]);
  for (const patchFile of discoveredPatches) {
    const src = fs.readFileSync(patchFile, 'utf-8');
    const matchBlock = src.match(/hostPermissions\s*:\s*\[([\s\S]*?)\]/);
    if (matchBlock) {
      const urls = matchBlock[1].match(/['"]([^'"]+)['"]/g) || [];
      for (const raw of urls) {
        extraHosts.add(raw.slice(1, -1));
      }
    }
  }
  baseManifest.host_permissions = Array.from(extraHosts);
  delete baseManifest.optional_host_permissions;
}

fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(baseManifest, null, 2),
  'utf-8'
);

// 6. If Public Profile: Run Isolation Verification and Package ZIP
if (profile === 'public') {
  console.log('\n[Public Build] Running isolation verification & creating monkeypatch-public.zip...');
  const { verifyPublicBuild } = await import('./verify-public-build.mjs');
  verifyPublicBuild(outDir);

  const zipPath = path.join(rootDir, 'dist', 'monkeypatch-public.zip');
  await createZipArchive(outDir, zipPath);
  console.log(`Created public ZIP: ${zipPath}`);

  // Also copy to api/wwwroot/downloads/monkeypatch-public.zip if ../api exists alongside this folder
  const apiRootDir = path.resolve(rootDir, '..', 'api');
  if (fs.existsSync(apiRootDir)) {
    const apiDownloadsDir = path.join(apiRootDir, 'wwwroot', 'downloads');
    fs.mkdirSync(apiDownloadsDir, { recursive: true });
    fs.copyFileSync(zipPath, path.join(apiDownloadsDir, 'monkeypatch-public.zip'));
    fs.writeFileSync(
      path.join(apiDownloadsDir, 'version.json'),
      JSON.stringify({ version: baseManifest.version, builtAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
    console.log(`Synced monkeypatch-public.zip to ${apiDownloadsDir}`);
  }
}

console.log(`\n[SUCCESS] MonkeyPatch [${profile.toUpperCase()}] build complete at: ${outDir}`);

function createZipArchive(sourceDir, targetZip) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(targetZip);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}
