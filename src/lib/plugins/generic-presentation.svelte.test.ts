import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount, type Component } from 'svelte';
import type { PluginManagementService } from '@writers-ide/plugins';
import { defineSveltePresentation, type SveltePresentation } from '@writers-ide/plugins/svelte';
import PluginManager from './PluginManager.svelte';
import PluginPresentation from './PluginPresentation.svelte';

const mounted = new Set<ReturnType<typeof mount>>();

afterEach(async () => {
	for (const component of mounted) {
		await unmount(component);
	}
	mounted.clear();
	document.body.replaceChildren();
});

const management: PluginManagementService = {
	list: () => [],
	subscribe(listener) {
		listener([]);
		return () => {};
	},
	activate() {
		throw new Error('No registered plugins');
	},
	planDeactivation() {
		throw new Error('No registered plugins');
	},
	deactivate() {
		throw new Error('No registered plugins');
	},
};

type PresentationProps = {
	management: PluginManagementService;
	failure: 'init' | null;
};

type LabelProps = {
	label: string;
};

// Delegate successful rendering to a real compiled component with specific required props.
const Presentation: Component<PresentationProps> = (anchor, props) => {
	if (props.failure === 'init') {
		throw new Error('Private initialization failure');
	}

	return PluginManager(anchor, props);
};

function render(presentation: SveltePresentation) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const props = $state({ presentation });
	mounted.add(mount(PluginPresentation, { target, props }));
	flushSync();
	return { target, props };
}

// Compile-time checks: callers infer ordinary object literal props without casts.
function checkProps(labelComponent: Component<LabelProps>) {
	defineSveltePresentation(labelComponent, { label: 'x' });
	const labelProps: LabelProps = { label: 'x' };
	defineSveltePresentation(labelComponent, labelProps);
	// @ts-expect-error Named props still require their mandatory fields.
	defineSveltePresentation(labelComponent, {});
	// @ts-expect-error Named props still reject incorrect value types.
	defineSveltePresentation(labelComponent, { label: 42 });
	defineSveltePresentation(PluginManager, { management });
	// @ts-expect-error The component's required prop must be supplied.
	defineSveltePresentation(PluginManager, {});
	// @ts-expect-error Prop values must satisfy the component's contract.
	defineSveltePresentation(PluginManager, { management: 'not a management service' });
}
void checkProps;

describe('generic trusted Svelte presentation adapter', () => {
	it('renders explicitly supplied typed props without a descriptor context field', () => {
		const presentation = defineSveltePresentation(PluginManager, { management });
		expect(Object.keys(presentation).sort()).toEqual(['component', 'props']);
		const { target } = render(presentation);
		expect(target.querySelector('h2')?.textContent).toBe('Plugin manager');
		expect(target.textContent).toContain('No bundled plugins are registered.');
	});

	it.each(['init'] as const)(
		'contains %s failures and recovers when the descriptor is replaced',
		(failure) => {
			const { target, props } = render(
				defineSveltePresentation(Presentation, { management, failure }),
			);
			expect(target.querySelector('[role="alert"]')?.textContent).toContain('Open Plugins');
			expect(target.textContent).not.toContain('Private');
			props.presentation = defineSveltePresentation(Presentation, { management, failure: null });
			flushSync();
			expect(target.querySelector('[role="alert"]')).toBeNull();
			expect(target.querySelector('h2')?.textContent).toBe('Plugin manager');
		},
	);

	it('recovers when props are replaced on the retained descriptor', () => {
		const { target, props } = render(
			defineSveltePresentation(Presentation, { management, failure: 'init' }),
		);
		expect(target.querySelector('[role="alert"]')).not.toBeNull();
		const descriptor = props.presentation;
		Object.assign(descriptor, { props: { management, failure: null } });
		flushSync();
		expect(props.presentation).toBe(descriptor);
		expect(target.querySelector('[role="alert"]')).toBeNull();
		expect(target.querySelector('h2')?.textContent).toBe('Plugin manager');
	});
});
