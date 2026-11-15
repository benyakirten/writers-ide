import { mount } from 'svelte';
import PluginsFixture from './PluginsFixture.svelte';

const target = document.getElementById('fixture');
if (!target) {
	throw new Error('Missing plugins fixture mount point');
}
mount(PluginsFixture, { target });
