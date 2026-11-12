import type { ArgumentsArgs } from '../../src/stories/performance/Arguments.svelte';
import type { PaginationSearchArgs } from '../../src/stories/performance/PaginationSearch.svelte';

/** Explicit IDs keep display-title changes from breaking automation. */
export interface StoryArgs {
	'Performance/Pagination search/Paragraph': PaginationSearchArgs;
	'Performance/Harness arguments/Echo': ArgumentsArgs;
}

export type StoryName = keyof StoryArgs;

export const stories = {
	'Performance/Harness arguments/Echo': {
		id: 'performance-harness-arguments--echo',
		args: ['label', 'enabled', 'amount', 'optional'],
	},
	'Performance/Pagination search/Paragraph': {
		id: 'performance-pagination-search--paragraph',
		args: ['repetitions', 'spanSize', 'linesToKeep', 'content', 'width'],
	},
} as const satisfies Record<StoryName, { id: string; args: readonly string[] }>;
