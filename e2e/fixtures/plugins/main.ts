import { mount } from 'svelte';
import PluginsFixture from './PluginsFixture.svelte';
import PresentationsFixture from './PresentationsFixture.svelte';
import ApplicationFixture from './ApplicationFixture.svelte';

const target = document.getElementById('fixture');
if (!target) {
	throw new Error('Missing plugins fixture mount point');
}
const params = new URLSearchParams(window.location.search);
const fixture = params.has('application')
	? ApplicationFixture
	: params.has('presentations')
		? PresentationsFixture
		: PluginsFixture;
mount(fixture, { target });
