// Trusted host code can reach SDK implementation files without creating another runtime copy.
export { CommandInvocationError } from '../../../packages-js/plugins/commands';
export { definePluginApi } from '../../../packages-js/plugins/index';
export { getContext } from 'svelte';
export const hostOnly = 'trusted-fixture-host';
