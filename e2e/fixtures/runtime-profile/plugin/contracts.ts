import { definePluginApi, definePluginCommand, type PluginCommand } from '@writers-ide/plugins';
import type { EditorView } from 'prosemirror-view';
import type { TaskOutcome } from '@writers-ide/tasks';
// This provider is a fixture experiment, not an author SDK worker-selection API.
export interface Probe {
	check(view: EditorView): boolean;
	worker(url: string, input: number, mode?: string): Promise<TaskOutcome<number>>;
	event(value: string): void;
	lifecycle(): (value: string) => void;
}
export const probeApi = definePluginApi<Probe>({ id: 'fixture.probe', major: 1 });
export interface Published {
	inspect(view: EditorView): boolean;
}
export const publishedApi = definePluginApi<Published>({ id: 'fixture.published', major: 1 });
const numberSchema: PluginCommand<number, number, number, number>['args'] = {
	'~standard': {
		version: 1 as const,
		vendor: 'fixture',
		validate(value: unknown) {
			return typeof value === 'number' ? { value } : { issues: [{ message: 'Expected number' }] };
		},
	},
};
export const double = definePluginCommand({
	id: 'fixture.double',
	major: 1,
	args: numberSchema,
	result: numberSchema,
});
