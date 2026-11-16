import type { Dispose } from '@writers-ide/plugins';

export type FormattingMark =
	| 'bold'
	| 'italic'
	| 'superscript'
	| 'subscript'
	| 'underline'
	| 'overline'
	| 'strikethrough';

export type FormattingBlockCommand =
	| 'indent'
	| 'dedent'
	| 'align-left'
	| 'align-center'
	| 'align-right'
	| 'align-justify';

export type FormattingCommand = FormattingMark | FormattingBlockCommand;

export type FormattingSnapshot = {
	viewId: string;
	revision: number;
	marks: Record<FormattingMark, number>;
	blocks: Record<FormattingBlockCommand, number>;
	enabled: Record<FormattingCommand, boolean>;
};

export type FormattingRequest = {
	viewId: string;
	revision: number;
	command: FormattingCommand;
};

/**
 * The service validates view identity, revision, and command availability on execute.
 * Subscription setup must be atomic: undo partial registration if subscribe throws.
 */
export interface FormattingService {
	subscribe(listener: (snapshot: FormattingSnapshot | null) => void): Dispose;
	execute(request: FormattingRequest): boolean;
}
