import type { Meta, StoryObj } from '@storybook/svelte';

import PaginationSearch, { type PaginationSearchArgs } from './PaginationSearch.svelte';

const meta = {
	title: 'Performance/Pagination search',
	id: 'performance-pagination-search',
	component: PaginationSearch,
	parameters: { layout: 'padded' },
	args: {
		repetitions: 1000,
		spanSize: 0,
		linesToKeep: 20,
		content: 'plain',
		width: 480,
	},
	argTypes: {
		repetitions: {
			control: { type: 'number', min: 0, step: 100 },
			description: 'Number of deterministic sample repetitions (not benchmark iterations).',
		},
		spanSize: {
			control: { type: 'number', min: 0, step: 1 },
			description: 'Unicode code points per span; 0 keeps all text in one span.',
		},
		linesToKeep: {
			control: { type: 'number', min: -1, step: 1 },
			description: 'Production rounded line threshold; -1 exercises none-fit.',
		},
		content: {
			type: { name: 'enum', value: ['plain', 'unicode'] },
			control: 'select',
			options: ['plain', 'unicode'],
		},
		width: { control: { type: 'number', min: 1, step: 16 } },
	},
} satisfies Meta<PaginationSearchArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Paragraph: Story = {};
