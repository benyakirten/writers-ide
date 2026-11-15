<script lang="ts">
	import type { EditorSnapshot, WordProcessingApi } from '@writers-ide/word-processing';
	import { toggleMark } from 'prosemirror-commands';

	let { api, commandId }: { api: WordProcessingApi; commandId: string } = $props();
	let target = $state.raw<EditorSnapshot | null>(null);
	let available = $state(false);
	let active = $state(false);

	$effect(() =>
		api.subscribe((snapshot) => {
			const current = snapshot.views.find((view) => view.viewId === snapshot.activeViewId) ?? null;
			target = current;
			available = false;
			active = false;
			if (!current) {
				return;
			}
			const result = api.inspect(
				current,
				({ state, editable }) => {
					const strong = state.schema.marks.bold ?? state.schema.marks.strong;
					if (!strong) {
						return { available: false, active: false };
					}
					const { from, to, empty, $from: resolvedFrom } = state.selection;
					return {
						available: editable && toggleMark(strong)(state),
						active: empty
							? Boolean(strong.isInSet(state.storedMarks ?? resolvedFrom.marks()))
							: state.doc.rangeHasMark(from, to, strong),
					};
				},
				{ requireActive: true },
			);
			if (result.ok) {
				available = result.value.available;
				active = result.value.active;
			}
		}),
	);

	function execute(): void {
		if (target) {
			api.executeCommand(target, commandId, { requireActive: true, focus: true });
		}
	}
</script>

<button
	type="button"
	aria-label="Quick bold"
	aria-pressed={active}
	disabled={!available}
	onclick={execute}
>
	<strong>B</strong>
</button>

<style>
	button {
		width: 2rem;
		height: 2rem;
		border: 1px solid currentColor;
		border-radius: 0.25rem;
	}
	button[aria-pressed='true'] {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}
</style>
