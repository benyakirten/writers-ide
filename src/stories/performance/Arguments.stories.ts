import type { Meta, StoryObj } from '@storybook/svelte';
import Arguments, { type ArgumentsArgs } from './Arguments.svelte';

const meta = {
	title: 'Performance/Harness arguments',
	id: 'performance-harness-arguments',
	// Storybook's locked types describe Svelte 4; its renderer accepts Svelte 5 functions.
	component: Arguments as unknown as Meta<ArgumentsArgs>['component'],
	args: { label: 'default', enabled: true, amount: 1, optional: 'default' },
	argTypes: {
		label: { type: 'string' },
		enabled: { type: 'boolean' },
		amount: { type: 'number' },
		optional: { type: 'string' },
	},
} satisfies Meta<ArgumentsArgs>;

export default meta;
export const Echo: StoryObj<typeof meta> = {};
