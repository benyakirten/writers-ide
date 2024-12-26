<script lang="ts">
	import Editor from '$lib/editor/Editor.svelte';
	import type { Blocks } from '$lib/types/block.js';

	let blocks: Blocks = $state([
		{
			classes: [],
			properties: {},
			id: 'myp1',
			content: 'Hello, world! I want to write a very long message that will span multiple lines.',
			type: 'p',
			children: []
		},
		{
			classes: [],
			properties: {},
			id: 'myp2',
			content: 'This is another long message that spans multiple lines..',
			type: 'p',
			children: []
		},
		{
			classes: [],
			properties: {},
			id: 'myp3',
			content: 'Short message!.',
			type: 'p',
			children: []
		}
	]);
</script>

<Editor bind:blocks />
