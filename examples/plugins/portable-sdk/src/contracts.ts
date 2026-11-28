import { definePluginApi, definePluginCommand, type PluginCommand } from '@writers-ide/plugins';
import type { EditorView } from 'prosemirror-view';

// The runtime-profile test host supplies this probe. It is not an SDK service.
export interface Probe {
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
		version: 1,
		vendor: 'portable-example',
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

function schema<Input, Output>(convert: (value: Input) => Output) {
	return {
		'~standard': {
			version: 1 as const,
			vendor: 'portable-example',
			types: undefined as { input: Input; output: Output } | undefined,
			validate(value: unknown) {
				return { value: convert(value as Input) };
			},
		},
	};
}
// Four roles: caller string -> handler number -> handler boolean -> caller Date.
export const fourRoles = definePluginCommand({
	id: 'portable.roles',
	major: 1,
	args: schema<string, number>((value) => Number(value)),
	result: schema<boolean, Date>((value) => new Date(value ? 1 : 0)),
});
