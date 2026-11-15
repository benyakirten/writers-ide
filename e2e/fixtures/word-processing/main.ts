import { mount } from 'svelte';
import WordProcessingFixture from './WordProcessingFixture.svelte';

const target = document.getElementById('fixture');
if (!target) {
	throw new Error('Missing word-processing fixture mount point');
}
mount(WordProcessingFixture, { target });
