<script module lang="ts">
	export interface PaginationSearchArgs {
		repetitions?: number;
		spanSize?: number;
		linesToKeep?: number;
		content?: 'plain' | 'unicode';
		width?: number;
	}

	export interface PaginationSearchResult extends Record<string, number> {
		splitOffset: number;
		probes: number;
		textLength: number;
	}
</script>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { installBenchmark } from '../../lib/testing/browser-benchmark';
	import { findTextSplitOffset } from '../../lib/editor/state/text-split-measurement';
	import {
		hybridSplitSearch,
		sequentialSplitSearch,
		type SplitSearchStrategy,
	} from '../../lib/editor/state/split-search';

	let {
		repetitions = 1000,
		spanSize = 0,
		linesToKeep = 20,
		content = 'plain',
		width = 480,
	}: PaginationSearchArgs = $props();

	const lineHeight = 24;
	const samples = {
		plain: 'The patient writer watches the river and records another quiet morning. ',
		unicode: 'Café e\u0301lan — Ελληνικά 日本語 🙂 👩‍💻; another quiet morning. ',
	};
	const text = $derived(samples[content].repeat(Math.max(0, Math.floor(repetitions))));
	const chunks = $derived.by(() => {
		const size = Math.max(0, Math.floor(spanSize));
		if (size === 0) {
			return [text];
		}
		// Do not turn a surrogate pair into two invalid strings at a span boundary.
		const characters = Array.from(text);
		const parts: string[] = [];
		for (let offset = 0; offset < characters.length; offset += size) {
			parts.push(characters.slice(offset, offset + size).join(''));
		}
		return parts;
	});

	let paragraph: HTMLParagraphElement;
	let output = $state('Not run yet.');
	let busy = $state(false);
	let nodes: Node[] = [];
	let nodeText: string[] = [];
	let originalText = '';
	let baseline = 0;
	let preparedLines = 0;
	let preparedWidth = 0;
	let preparedSpanSize = 0;
	let prepared = false;

	/** Independent old loop: no shared measurement helper or search strategy. */
	function oldSequentialOffset(): number {
		if (nodes.length === 0) {
			return 0;
		}
		const range = paragraph.ownerDocument.createRange();
		range.setStart(nodes[0], 0);
		let total = 0;
		for (const node of nodes) {
			const length = node.textContent?.length ?? 0;
			for (let offset = 0; offset < length; offset++) {
				range.setEnd(node, offset);
				if (Math.round(range.getBoundingClientRect().height / lineHeight) - 1 >= preparedLines) {
					return total + offset;
				}
			}
			total += length;
		}
		return total;
	}

	async function prepare(): Promise<void> {
		prepared = false;
		await tick();
		await paragraph.ownerDocument.fonts.ready;
		await tick();
		const walker = paragraph.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
		nodes = [];
		let node = walker.nextNode();
		while (node !== null) {
			nodes.push(node);
			node = walker.nextNode();
		}
		nodeText = nodes.map((node) => node.textContent ?? '');
		originalText = paragraph.textContent ?? '';
		if (originalText !== text) {
			throw new Error('Rendered fixture does not match the deterministic source text.');
		}
		preparedLines = linesToKeep;
		preparedWidth = width;
		preparedSpanSize = spanSize;
		baseline = oldSequentialOffset();

		// Known answers independent of the old loop, including the unmeasured end sentinel.
		const allFit = findTextSplitOffset(
			nodes,
			lineHeight,
			Number.MAX_SAFE_INTEGER,
			hybridSplitSearch,
		);
		if (allFit !== originalText.length) {
			throw new Error('All-fit search must return the UTF-16 text length.');
		}
		for (const strategy of [sequentialSplitSearch, hybridSplitSearch]) {
			if (findTextSplitOffset(nodes, lineHeight, -1, strategy) !== 0) {
				throw new Error('None-fit search must return zero (also for empty text).');
			}
		}
		prepared = true;
	}

	function reset(): void {
		// Searches only measure ranges; there is no mutated fixture state to restore.
	}

	function run(variant: string): PaginationSearchResult {
		if (
			!prepared ||
			text !== originalText ||
			width !== preparedWidth ||
			spanSize !== preparedSpanSize ||
			linesToKeep !== preparedLines
		) {
			throw new Error('Call prepare() after changing the story controls.');
		}
		let strategy: SplitSearchStrategy;
		if (variant === 'sequential') {
			strategy = sequentialSplitSearch;
		} else if (variant === 'hybrid') {
			strategy = hybridSplitSearch;
		} else {
			throw new Error(`Unknown pagination search variant: ${variant}`);
		}
		let probes = 0;
		const counted: SplitSearchStrategy = (end, fails) =>
			strategy(end, (offset) => {
				probes++;
				return fails(offset);
			});
		const splitOffset = findTextSplitOffset(nodes, lineHeight, preparedLines, counted);
		return { splitOffset, probes, textLength: originalText.length };
	}

	function verify(result: PaginationSearchResult): void {
		if (result.splitOffset !== baseline || result.textLength !== originalText.length) {
			throw new Error(
				`Expected split ${baseline}/${originalText.length}, got ${JSON.stringify(result)}.`,
			);
		}
		if (
			paragraph.textContent !== originalText ||
			nodes.some((node, index) => !paragraph.contains(node) || node.textContent !== nodeText[index])
		) {
			throw new Error('Search changed the fixture text or its text nodes.');
		}
	}

	async function compare(): Promise<void> {
		busy = true;
		try {
			await prepare();
			reset();
			const sequential = run('sequential');
			verify(sequential);
			reset();
			const hybrid = run('hybrid');
			verify(hybrid);
			output = `Verified split ${baseline} / ${originalText.length} UTF-16 units; sequential: ${sequential.probes} probes; hybrid: ${hybrid.probes} probes.`;
		} catch (error) {
			output = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	onMount(() => installBenchmark({ prepare, reset, run, verify }));
</script>

<section aria-label="Pagination search benchmark">
	<h1>Paragraph split search</h1>
	<p>
		Use Storybook Controls to vary the paragraph, then compare the real browser Range searches.
		Repetitions controls text length, not benchmark iterations. Span size 0 uses one span; positive
		values split Unicode code points across alternating plain, strong, and emphasized spans.
	</p>
	<p>
		The benchmark bridge accepts <code>sequential</code> and <code>hybrid</code>. Call prepare
		before each benchmark operation; baseline and edge checks are outside the measured run. Set
		repetitions to 0 for empty text, lines to keep to -1 for none-fit, or 1000000 for all-fit with
		the default text. This measures search only, not end-to-end editor pagination.
	</p>
	<button type="button" onclick={compare} disabled={busy}>
		{busy ? 'Comparing…' : 'Compare and verify searches'}
	</button>
	<p role="status">{output}</p>
	<div class="viewport">
		<p class="fixture" bind:this={paragraph} style:width="{width}px">
			{#each chunks as chunk, index}<span
					>{#if index % 3 === 1}<strong>{chunk}</strong>{:else if index % 3 === 2}<em>{chunk}</em
						>{:else}{chunk}{/if}</span
				>{/each}
		</p>
	</div>
</section>

<style>
	section {
		max-width: 60rem;
	}

	.viewport {
		max-height: 36rem;
		overflow: auto;
		border: 1px solid #888;
	}

	.fixture {
		box-sizing: content-box;
		margin: 0;
		padding: 0;
		border: 0;
		font: 16px / 24px monospace;
		letter-spacing: 0;
		text-indent: 0;
		text-align: left;
		white-space: normal;
		overflow-wrap: anywhere;
	}

	.fixture span,
	.fixture strong,
	.fixture em {
		font-family: inherit;
		font-size: inherit;
		line-height: inherit;
	}
</style>
