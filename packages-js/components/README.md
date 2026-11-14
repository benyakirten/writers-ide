# @writers-ide/components

Optional Svelte 5 presentation primitives for formatting controls and other small toolbars. This is a **private, source-exported workspace library**, not a published SDK or a plugin sandbox. Use a Svelte-aware bundler; there is no build step or generated JavaScript distribution.

## What you can do

- Render an `IconButton` with a translated accessible label, your own icon snippet, disabled state and fractional selection inversion.
- Wrap arbitrary content in `Tooltip`, using text or a Svelte snippet as its tooltip.
- Share delayed hover/focus tooltips through a `TooltipProvider`, or explicitly pass a `TooltipState` as `manager` to triggers and a `Pointer` renderer.
- Suppress an entire tooltip scope during docking or another interaction using nested, idempotently released leases.

No application aliases, app singleton, plugin contracts, ProseMirror, icon library, Tailwind, network or native service is required. Svelte is the only peer dependency. Labels and icon content come from the consumer; these primitives do not translate or execute formatting commands.

## Minimal use

```svelte
<script lang="ts">
	import { IconButton, TooltipProvider } from '@writers-ide/components';

	let active = $state(false);
</script>

<TooltipProvider>
	<IconButton
		label="Bold"
		tooltipDirection="vertical"
		inversion={active ? 1 : 0}
		onclick={() => {
			active = !active;
		}}
	>
		{#snippet icon()}<strong>B</strong>{/snippet}
	</IconButton>
</TooltipProvider>
```

The provider creates an independent manager and renders one pointer. It cancels owned work on destruction. There is **no hidden global/default service**. A button or tooltip outside a provider must receive `manager`; otherwise initialization throws a descriptive error. `provideTooltipManager(manager)` and `getTooltipManager()` are also available during Svelte component initialization for custom providers.

## System design and lifetime

`IconButton → Tooltip → TooltipState → Pointer`: the trigger records the content, target and calibration direction; the service coordinates debounce, accessibility association, suppression and positioning; the pointer renders the current tooltip. Tooltip snippet rendering and effects have a local Svelte error boundary in `Pointer`, with a generic “Tooltip unavailable” fallback. A new descriptor or snippet content resets the boundary; dismissal and host controls remain outside it. This contains Svelte rendering/effect failures, not asynchronous callbacks or event-handler errors, and is not a plugin sandbox. Context supplies identity, not application authority. A manager prop overrides context. Manager identity is fixed at component initialization: remount to change scopes.

Each manager has a unique tooltip ID by default; `new TooltipState('my-tooltip-id')` allows a host-owned ID (keep it unique within a document). Each scope needs **exactly one** mounted `Pointer`. `TooltipProvider` accepts `manager`, `renderPointer` (default `true`) and `zIndex` (default `10000`). An injected manager remains host-owned; the host should call `clear()` when its lifetime ends. Unmounting a pointer cancels pending work and removes accessibility state; unmounting a trigger only clears a tooltip owned by that trigger.

```ts
import { TooltipState } from '@writers-ide/components';

const manager = new TooltipState();
const releaseOuter = manager.suppress();
const releaseInner = manager.suppress();
// Tooltips are dismissed immediately; suppressed requests are discarded, not replayed.
releaseOuter();
releaseOuter(); // safe, still suppressed by the inner lease
releaseInner();
// A fresh hover/focus request can now show a tooltip after 200 ms.
manager.clear(); // cancel timers/animation frames and clear accessibility associations
```

Repeated requests for the same debounce value keep the original deadline. `dismiss()` only dismisses the current tooltip/calibration, preserving the legacy debounce contract; `clear()` also cancels/reset pending debounce work. Suppression leases retain their original release semantics. `tooltipDebouncer`, `open`, `tooltip`, `tooltipEl`, `set()`, `show()`, `dismiss()` and the calibration methods remain available for compatibility; normal consumers use triggers and leases.

`tooltipDirection="vertical"` prefers above the target and flips below near the top edge; `"horizontal"` prefers left and flips right near the left edge. Existing 15px margin, arrow geometry and bounded animation-frame calibration retries are retained. Positioning is absolute in the pointer's containing block, using viewport target rectangles, as in the app implementation: mount the pointer in the top-level, untransformed overlay coordinate space. Arbitrary scrolled/positioned containers and full four-edge collision avoidance are not newly supported.

## Styles and accessibility

Component-local plain CSS supplies button reset, disabled opacity/cursor, inversion overlay, tooltip border/arrow and fade animation. Icons retain their own sizing/styles. The existing pink tooltip background is the default; customize `--tooltip-background` and `--tooltip-color` on an ancestor. `zIndex` controls the pointer stacking level. No stylesheet import or Tailwind scan is needed.

Buttons retain translated `aria-label`, native keyboard activation and focus outlines, and use `type="button"`. Hover and focus both request tooltips; Escape clears them. An icon button's `aria-describedby` is attached to the actual button while open and removed on dismissal/cleanup. Generic `Tooltip` defaults to its wrapper as the target; pass `target` to associate it with a particular focusable element.

## Writer's IDE integration

The app compatibility wrappers still inject **one** singleton from `src/lib/services/tooltip.svelte.ts` (`builtin-tooltip`), shared with docking suppression. Formatting `Snippets.svelte` now imports the package directly and requires this same instance in ancestor context.

The root app includes this package as a workspace dependency and imports its public API through `@writers-ide/components`. The root `Editor` integration supplies the shared manager to all formatting presentations:

```svelte
<script lang="ts">
	import { TooltipProvider } from '@writers-ide/components';
	import TooltipManager from '$lib/services/tooltip.svelte';
	import Editor from '$lib/editor/Editor.svelte';
</script>

<TooltipProvider manager={TooltipManager} renderPointer={false}>
	<Editor />
</TooltipProvider>
```

Keep the existing app `Pointer` inside `Editor`: `renderPointer={false}` avoids a duplicate renderer/ID. Do not create a second manager for plugin toolbars, or docking suppression will not cover them. DOM-only relocation does not change Svelte context; a separately mounted Svelte root needs its own provider using the same host manager and no extra pointer.

Tests that mount formatting presentations directly use a host-owned provider fixture with an isolated test manager, preserving their formatting and lifecycle assertions. The standalone component-library tests import the public package API; their nonexported Svelte fixture stays a relative test-only import and is not part of the package exports.
