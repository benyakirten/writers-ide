import { mount } from 'svelte';
import PluginsFixture from './PluginsFixture.svelte';
import PresentationsFixture from './PresentationsFixture.svelte';

const target = document.getElementById('fixture');
if (!target) {
	throw new Error('Missing plugins fixture mount point');
}
const fixture = new URLSearchParams(window.location.search).has('presentations')
	? PresentationsFixture
	: PluginsFixture;
mount(fixture, { target });
