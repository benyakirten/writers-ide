import { defineTaskWorker, type TaskWorkerScope } from '@writers-ide/tasks/worker';
import type { AnalysisInput } from './word-analysis';
import type { ModelRange } from './selection-highlight';

declare const self: TaskWorkerScope;

// Match offsets are UTF-16, just like ProseMirror text-node positions. Tokens never
// cross text-node/chunk boundaries (including adjacent nodes separated by marks).
defineTaskWorker<AnalysisInput, ModelRange[]>(self, ({ chunks }) => {
	const words = new Map<string, ModelRange[]>();
	for (const chunk of chunks) {
		for (const match of chunk.text.matchAll(/\p{L}+/gu)) {
			const word = match[0].toLowerCase();
			const ranges = words.get(word) ?? [];
			ranges.push({
				from: chunk.from + match.index,
				to: chunk.from + match.index + match[0].length,
			});
			words.set(word, ranges);
		}
	}
	return [...words.values()]
		.filter((ranges) => ranges.length > 1)
		.flat()
		.sort((a, b) => a.from - b.from);
});
