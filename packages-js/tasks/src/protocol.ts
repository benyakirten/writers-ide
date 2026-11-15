export type WorkerRequest<I> = { type: 'tasks:run'; input: I };
export type WorkerResponse<O> =
	| { type: 'tasks:result'; value: O }
	| { type: 'tasks:error'; error: { name: string; message: string; stack?: string } };

export function serializeError(error: unknown): { name: string; message: string; stack?: string } {
	try {
		if (error instanceof Error) {
			return { name: error.name, message: error.message, stack: error.stack };
		}
		return { name: 'Error', message: String(error) };
	} catch {
		return { name: 'Error', message: 'Worker failed with an unserializable error' };
	}
}
