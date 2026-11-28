import { Channel, invoke } from '@tauri-apps/api/core';
import { mountShutdown } from './shutdown-model.mjs';

const shutdown = mountShutdown({ document, invoke, channel: () => new Channel() });
window.addEventListener('pagehide', shutdown.dispose, { once: true });
