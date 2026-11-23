import type { Dispose } from './index';
import { hasErrorCode } from './error-guard';

export type NativeRequestOptions = { readonly signal?: AbortSignal };

export type FileIndexEntry = {
	readonly path: string;
	readonly kind: 'file' | 'directory' | 'unsupported';
	readonly sizeBytes: number | null;
	readonly modifiedAt: number | null;
};

export type FileIndexStatus = {
	readonly revision: string;
	readonly initialized: boolean;
	readonly reconciling: boolean;
	readonly needsReconciliation: boolean;
	readonly lastReconciledAt: number | null;
	readonly lastError: string | null;
};

export type FileIndexQueryOptions = NativeRequestOptions & { readonly after?: string };

export type FileIndexPage = {
	readonly entries: readonly FileIndexEntry[];
	readonly status: FileIndexStatus;
	readonly nextToken: string | null;
};

/** Host-supplied, project-opening-bound service. Availability does not grant operations. */
export interface ProjectFiles {
	read(path: string, options?: NativeRequestOptions): Promise<Uint8Array>;
	queryIndex(directory: string, options?: FileIndexQueryOptions): Promise<FileIndexPage>;
	subscribeIndex(
		listener: (status: FileIndexStatus) => void,
		options?: NativeRequestOptions,
	): Promise<Dispose>;
}

export interface ExternalLinks {
	open(url: string, options?: NativeRequestOptions): Promise<void>;
}

/** Describes services only; importing these contracts supplies no native authority. */
export type NativeServices = {
	readonly projectFiles: ProjectFiles | null;
	readonly externalLinks: ExternalLinks | null;
};

export type NativeErrorCode =
	| 'revoked'
	| 'cancelled'
	| 'permission-denied'
	| 'invalid-input'
	| 'unavailable'
	| 'not-found'
	| 'limit-exceeded'
	| 'unsupported-entry'
	| 'io';

export type NativeServiceError = Error & { readonly code: NativeErrorCode };

const nativeErrorCodes: ReadonlySet<string> = new Set<NativeErrorCode>([
	'revoked',
	'cancelled',
	'permission-denied',
	'invalid-input',
	'unavailable',
	'not-found',
	'limit-exceeded',
	'unsupported-entry',
	'io',
]);

/** Recognizes representation only, not the error's origin or authority. */
export function isNativeServiceError(value: unknown): value is NativeServiceError {
	return hasErrorCode(value, nativeErrorCodes);
}
