# @writers-ide/components

`@writers-ide/components` provides optional Svelte 5 buttons and tooltips for small toolbars. Use `IconButton` for a labelled icon control. Use `Tooltip` to add a tooltip to other content. A `TooltipProvider` gives those controls a shared tooltip manager and renderer. The manager tracks which tooltip is open. The renderer displays it.

Your feature supplies labels, icons, and click behavior. The library does not translate text or execute formatting commands. A feature plugin can use these components, but the library has no plugin lifecycle of its own.

This is a private workspace library that exports source files. It is not a published SDK or a plugin sandbox. Use a Svelte-aware bundler. There is no build step or generated JavaScript distribution.

## What you can do

- Render an `IconButton` with your translated accessible label, icon snippet, and disabled state. Its inversion value can show partial selection coverage, such as a selection where only half the text is bold.
- Wrap content in `Tooltip`. Supply tooltip text or a Svelte snippet.
- Share delayed hover/focus tooltips through `TooltipProvider`. For explicit wiring, pass a `TooltipState` as `manager` to both triggers and a `Pointer` renderer.
- Temporarily suppress a manager's tooltips during docking or another interaction. Nested suppression leases keep them hidden until every lease is released.

Svelte is the only peer dependency. You do not need application aliases, an app singleton, plugin contracts, ProseMirror, an icon library, Tailwind, network access, or a native service.

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

This button toggles local state; it does not format an editor. The provider creates an independent manager and renders one `Pointer`, the component that displays the current tooltip. When destroyed, the provider cancels work owned by that manager.

There is no hidden global or default service. A button or tooltip outside a provider must receive `manager`. Otherwise, initialization throws a descriptive error.

Svelte component context passes a manager from an ancestor to its descendants. It does not create an application-wide global. Custom providers can call `provideTooltipManager(manager)` and `getTooltipManager()` during component initialization.

## System design and lifetime

### How a tooltip appears

`IconButton` uses `Tooltip` as its trigger. The trigger records the tooltip content, target element, and preferred direction. `TooltipState` manages the delay, accessibility association, suppression, and position. `Pointer` renders the current tooltip.

A `manager` prop overrides the manager from context. Components choose their manager during initialization. Remount them to change to another manager. Context selects an instance; it does not grant application permissions.

### Rendering failures

A Svelte error boundary catches failures in the rendering and effects it contains. `Pointer` places one around tooltip snippets. If a snippet fails to render or its effect fails, the boundary shows “Tooltip unavailable”.

The tooltip descriptor is the record of what the trigger wants to display. A new descriptor or new snippet content resets the boundary. Dismissal and host controls remain outside the boundary.

This boundary does not catch asynchronous callback or event-handler errors. It is not a plugin sandbox.

### Instance ownership

Each manager gets a unique tooltip ID by default. Use `new TooltipState('my-tooltip-id')` to supply your own. Keep that ID unique within the document.

Each manager's scope needs exactly one mounted `Pointer`. `TooltipProvider` accepts `manager`, `renderPointer` (default `true`), and `zIndex` (default `10000`). If you inject a manager, you still own it. Call `clear()` when its lifetime ends.

Unmounting a pointer cancels pending work and removes accessibility state. Unmounting a trigger only clears a tooltip owned by that trigger.

### Temporary suppression

A suppression lease is a release function returned by `suppress()`. Tooltips remain suppressed until all leases are released. Each release function is safe to call more than once:

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

Debouncing delays a request instead of acting immediately. Here, repeated requests for the same value keep the original deadline.

Position calibration measures the tooltip and adjusts its placement. `dismiss()` hides the current tooltip and stops that calibration. It does not reset pending debounce work. `clear()` also cancels and resets that pending work. Existing suppression leases keep their release semantics.

Normal consumers use triggers and suppression leases. The lower-level API exposes `tooltipDebouncer`, `open`, `tooltip`, `tooltipEl`, `set()`, `show()`, `dismiss()`, and the calibration methods.

### Positioning limits

`tooltipDirection="vertical"` prefers above the target. It flips below near the top edge. `"horizontal"` prefers left and flips right near the left edge.

The implementation retains its 15px margin and arrow geometry. It retries position calibration on animation frames, but limits the number of retries.

The pointer's containing block is the CSS ancestor that defines its absolute-positioning coordinates. The target's measured rectangle instead uses coordinates relative to the viewport. Mount the pointer in a top-level overlay with no CSS transform so those coordinate spaces align.

Arbitrary scrolled or positioned containers are not supported by this arrangement. Positioning also does not check and avoid all four viewport edges.

## Styles and accessibility

Component-local plain CSS supplies the button reset, disabled opacity and cursor, inversion overlay, tooltip border and arrow, and fade animation. Icons keep their own sizing and styles. No stylesheet import or Tailwind scan is needed.

The default tooltip background is pink. Customize `--tooltip-background` and `--tooltip-color` on an ancestor. `zIndex` controls the pointer's stacking level.

Buttons use the translated label you supply as `aria-label`. They retain native keyboard activation and focus outlines, and use `type="button"`. Hover and focus both request tooltips. Escape clears them.

`aria-describedby` links a control to its accessible description. While a tooltip is open, that attribute is attached to the actual icon button. Dismissal and cleanup remove it. A generic `Tooltip` uses its wrapper as the target by default. Pass `target` to associate it with a particular focusable element.

## Writer's IDE integration

The library supports independent managers and does not import application globals. Writer's IDE chooses to share one application-owned singleton from `src/lib/services/tooltip.svelte.ts` (`builtin-tooltip`). App wrappers supply it, and docking uses it to suppress tooltips during a drag.

Formatting `Snippets.svelte` imports the package directly. It needs that same instance in ancestor context so docking suppression also covers formatting controls.

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

Keep the existing app `Pointer` inside `Editor`. `renderPointer={false}` avoids a duplicate renderer and ID. Do not create a second manager for plugin toolbars; docking suppression would not cover it.

Moving existing DOM does not change Svelte context. A separately mounted Svelte root needs its own provider. Use the same host manager and do not render an extra pointer.

Tests that mount formatting presentations directly use a host-owned provider fixture and an isolated manager. They still check formatting behavior and lifecycle cleanup.

Standalone component-library tests import the public package API. Their Svelte fixture is a relative test-only import. It is not part of the package exports.
