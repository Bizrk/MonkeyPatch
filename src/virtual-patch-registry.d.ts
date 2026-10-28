import type { MonkeyPatchDefinition } from './sdk/types';

declare module 'virtual:patch-registry' {
  export const patches: MonkeyPatchDefinition[];
  export const buildProfile: 'public' | 'personal';
}
