import type { MonkeyPatchDefinition } from '../../../src/sdk/types';
import { mountDemoNotesPanel } from './ui';

const demoPatch: MonkeyPatchDefinition = {
  id: 'demo-notes',
  name: 'Demo Page & Domain Notes',
  description: 'Saves and displays URL-scoped and domain-scoped notes using the generic MonkeyPatch SDK.',
  matches: [
    'https://example.com/*',
    'http://localhost:27246/demo*',
    'http://localhost:*/demo*',
    'http://127.0.0.1:27246/demo*',
    'http://127.0.0.1:*/demo*',
    'https://stash.monkeybrain.cc/demo*',
    'https://*.local/demo*',
  ],
  runOnSpaNavigation: true,
  usesPanel: true,

  async run(ctx) {
    const store = ctx.store.namespace('demo-notes');
    ctx.log.info(`Initializing Demo Notes patch on ${ctx.page.url}`);

    const unmount = mountDemoNotesPanel(ctx, store);
    ctx.onCleanup(() => {
      unmount();
    });
  },
};

export default demoPatch;
