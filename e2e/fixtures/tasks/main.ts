import { mount } from 'svelte';
import TasksFixture from './TasksFixture.svelte';

const target = document.getElementById('fixture');
if (!target) {
	throw new Error('Missing tasks fixture mount point');
}
mount(TasksFixture, { target });
