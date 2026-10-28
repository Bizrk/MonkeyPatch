import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export function verifyPublicBuild(publicDistDir = path.join(rootDir, 'dist', 'public')) {
  if (!fs.existsSync(publicDistDir)) {
    throw new Error(`Public build directory does not exist: ${publicDistDir}`);
  }

  const forbiddenTokens = [
    'patches/personal',
    'patches\\personal',
    'buildProfile = "personal"',
    "buildProfile = 'personal'",
  ];
  const personalDir = path.join(rootDir, 'patches', 'personal');

  if (fs.existsSync(personalDir)) {
    const entries = fs.readdirSync(personalDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        forbiddenTokens.push(`patches/personal/${entry.name}`);
        const idxFile = path.join(personalDir, entry.name, 'index.ts');
        if (fs.existsSync(idxFile)) {
          const content = fs.readFileSync(idxFile, 'utf-8');
          const idMatch = content.match(/id\s*:\s*['"]([^'"]+)['"]/);
          if (idMatch && idMatch[1]) {
            forbiddenTokens.push(idMatch[1]);
          }
        }
      }
    }
  }

  const allFiles = getAllFiles(publicDistDir);
  for (const file of allFiles) {
    if (file.endsWith('.map')) {
      throw new Error(`SECURITY VIOLATION: Source map found in public build: ${file}`);
    }

    if (/\.(js|json|html|css|txt)$/i.test(file)) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const token of forbiddenTokens) {
        if (content.includes(token)) {
          throw new Error(
            `SECURITY VIOLATION: Public artifact '${path.relative(
              publicDistDir,
              file
            )}' contains forbidden personal marker '${token}'.`
          );
        }
      }
    }
  }

  const manifestPath = path.join(publicDistDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (String(manifest.name || '').includes('Personal')) {
    throw new Error('SECURITY VIOLATION: Public manifest.json contains Personal build title.');
  }

  console.log('[VERIFY PASS] Public build artifacts verified clean of personal patches and source maps.');
}

function getAllFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyPublicBuild();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
