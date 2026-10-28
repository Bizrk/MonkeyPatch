import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

/**
 * Resolves the active build profile.
 * FAIL-CLOSED: Any missing or unrecognized profile defaults strictly to 'public'.
 */
export function resolveBuildProfile(rawProfile) {
  if (rawProfile && String(rawProfile).trim().toLowerCase() === 'personal') {
    return 'personal';
  }
  return 'public';
}

export function discoverPatchEntryFiles(profile) {
  const entries = [];

  const scanDir = (baseDir) => {
    if (!fs.existsSync(baseDir)) return;
    const subdirs = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const dirent of subdirs) {
      if (!dirent.isDirectory()) continue;
      if (dirent.name.startsWith('.')) continue;
      const indexTs = path.join(baseDir, dirent.name, 'index.ts');
      const indexTsx = path.join(baseDir, dirent.name, 'index.tsx');
      if (fs.existsSync(indexTs)) {
        entries.push(indexTs);
      } else if (fs.existsSync(indexTsx)) {
        entries.push(indexTsx);
      }
    }
  };

  // Always include public example patches
  scanDir(path.join(rootDir, 'patches', 'examples'));

  // ONLY include personal patches when profile is explicitly 'personal'
  if (profile === 'personal') {
    scanDir(path.join(rootDir, 'patches', 'personal'));
  }

  return entries;
}

export function patchRegistryPlugin(profile) {
  const virtualModuleId = 'virtual:patch-registry';
  const resolvedVirtualModuleId = '\0' + virtualModuleId;

  return {
    name: 'monkeypatch-registry-plugin',
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
      return null;
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        const patchFiles = discoverPatchEntryFiles(profile);
        const imports = patchFiles
          .map((filePath, idx) => {
            const normalized = filePath.replace(/\\/g, '/');
            return `import patch_${idx} from '${normalized}';`;
          })
          .join('\n');

        const arrayItems = patchFiles.map((_, idx) => `patch_${idx}`).join(', ');

        return `
${imports}
export const buildProfile = '${profile}';
export const patches = [${arrayItems}];
`;
      }
      return null;
    },
  };
}
