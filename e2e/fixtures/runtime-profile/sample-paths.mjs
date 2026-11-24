import { fileURLToPath } from 'node:url';

/** @param {string} filename */
export function normalizePath(filename) {
	return filename.replaceAll('\\', '/');
}

/** Vite accepts forward-slash filesystem imports, including Windows drive paths.
 * @param {URL} url
 * @param {{windows?: boolean}} [options]
 */
export function fileImportSpecifier(url, options) {
	return normalizePath(fileURLToPath(url, options));
}
