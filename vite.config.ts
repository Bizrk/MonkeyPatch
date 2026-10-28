import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {
  resolveBuildProfile,
  discoverPatchEntryFiles,
  patchRegistryPlugin,
} from './scripts/patch-discovery.mjs';

export { resolveBuildProfile, discoverPatchEntryFiles, patchRegistryPlugin };

export default defineConfig(() => {
  const profile = resolveBuildProfile(process.env.BUILD_PROFILE);
  return {
    plugins: [react(), patchRegistryPlugin(profile)],
    build: {
      sourcemap: false,
      emptyOutDir: false,
    },
  };
});
