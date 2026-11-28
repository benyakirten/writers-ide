import { createResourceProbe } from './resource-probe.js';

const config = window.__RESOURCE_PROTOTYPE__ ?? {};
const role = config.role === 'peer' ? 'peer' : 'denied';
window.__RESOURCE_PROTOTYPE_PROBE__ = createResourceProbe(config, role);
void window.__RESOURCE_PROTOTYPE_PROBE__('initial');
