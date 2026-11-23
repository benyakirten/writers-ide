/** Property access and instanceof can throw for unrelated values such as revoked proxies. */
export function hasErrorCode(value: unknown, codes: ReadonlySet<string>): boolean {
	try {
		if (typeof value !== 'object' || value === null) {
			return false;
		}
		// Other realms have a different Error constructor. Representation is not provenance.
		const error =
			value instanceof Error || Object.prototype.toString.call(value) === '[object Error]';
		return (
			error &&
			'name' in value &&
			typeof value.name === 'string' &&
			'message' in value &&
			typeof value.message === 'string' &&
			'code' in value &&
			typeof value.code === 'string' &&
			codes.has(value.code)
		);
	} catch {
		return false;
	}
}
