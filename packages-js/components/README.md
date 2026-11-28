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

## Tooltips in plugin presentations

**Approved external-plugin direction; production loading is not implemented:** registered Svelte toolbar and workspace-view presentations receive tooltip context from the host. Ordinary plugin UI should inherit it rather than create its own manager or mount another `Pointer`. The host owns shared tooltip rendering, overlay placement/stacking, suppression during docking and the manager's lifetime. `IconButton`, `Tooltip` and `TooltipData` are approved author-facing exports. The five advanced composition exports are also approved, as described below.

An independently mounted Svelte root does not inherit context just because its DOM is inside the application. Independent UI trees can use explicitly owned local scopes. The current library supports those scopes as shown below; their advanced external SDK exports are approved, though production external loading is not implemented. Do not use a locally mounted renderer to take ownership of the host's shared manager.

## Advanced tooltip composition

`TooltipProvider`, `TooltipState`, `Pointer`, `getTooltipManager` and `provideTooltipManager` are approved advanced author exports alongside the ordinary controls. Use host-supplied context for normal plugin presentations. Use these tools when intentionally owning an independent scope, implementing a custom trigger/provider or composing a local renderer separately.

This approval includes the current reachable `TooltipState` API, not just its constructor. It exposes mutable `open`, `tooltip` and `tooltipEl` state; `tooltipDebouncer`; ID, timing, retry and margin fields; and `set()`, `show()`, `dismiss()`, `clear()`, `suppress()`, `attemptCalibration()` and `calibratePosition()`. Low-level callers must preserve the manager's rendering and lifetime invariants. These fields are not a restricted handle to application state.

Call the context helpers during Svelte component initialization. They select or provide a manager but do not transfer ownership. A provider owns a manager it creates. A supplied manager remains caller-owned. Each scope needs one mounted `Pointer`. Do not mount a disposable pointer or a provider with its own renderer over the host's shared manager: pointer teardown clears the manager and can affect other controls. Use a local manager for independently owned renderers.

The examples and lifetime sections below show the current library behavior. Production external-profile integration is still outstanding.

## Minimal use

This standalone example creates its own tooltip scope. It is not the setup required inside a host-provided plugin presentation.

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

## Rich tooltip content

`Tooltip` accepts a string or a Svelte snippet. A snippet can render markup or other Svelte components. In the general-purpose wrapper, ordinary children are the trigger and the named `tooltip` snippet is the content displayed by the tooltip renderer.

Place this example in a component below a `TooltipProvider`. The current application's presentation tree supplies that context. For standalone use, provide a scope as in the minimal example above. The button element is passed explicitly so positioning and its accessibility description refer to the actual trigger:

```svelte
<script lang="ts">
	import { Tooltip } from '@writers-ide/components';

	let trigger = $state<HTMLButtonElement>();
</script>

<Tooltip target={trigger} calibrateFor="vertical">
	{#snippet tooltip()}
		<strong>Word statistics</strong>
		<span>Show counts for the current document.</span>
	{/snippet}

	<button type="button" bind:this={trigger}>Statistics</button>
</Tooltip>
```

Authors can replace the snippet's markup with their own Svelte components. A custom button component must expose its trigger element when explicit association is needed. Do not infer that an arbitrary parent component is the trigger.

`IconButton` already includes tooltip wiring to its own button. Its optional `tooltip` prop accepts a string or named snippet. Without custom content it uses the accessible `label`. Rich visual content is supported; interactive buttons, links and forms need a popover with deliberate focus and dismissal behavior, not an ordinary tooltip.

## Planned shared controls

The library is intended to grow beyond buttons and tooltips. Selects, comboboxes and virtual lists are approved future-work direction, not implemented exports or Part 4 prerequisites. Their APIs, accessibility, keyboard/focus behavior and data contracts need review before implementation. Virtual lists also need bounded rendering and real-browser validation. Shared controls remain optional; plugin authors may use their own components.

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
