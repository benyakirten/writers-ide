export function isMac(): boolean {
	if (!window || !window.navigator) {
		return false;
	}
	return navigator.userAgent.toLocaleLowerCase().includes('mac');
}
