<script>
	import './button.css';

	/**
	 * @typedef {Object} Props
	 * @property {boolean} [primary] Is this the principal call to action on the page?
	 * @property {string} [backgroundColor] What background color to use
	 * @property {'small' | 'medium' | 'large'} [size] How large should the button be?
	 * @property {string} label Button contents
	 * @property {() => void} [onclick] The onclick event handler
	 */

	/** @type {Props} */
	const { primary = false, backgroundColor, size = 'medium', label, onclick } = $props();
</script>

<button
	type="button"
	class={['storybook-button', `storybook-button--${size}`].join(' ')}
	class:storybook-button--primary={primary}
	class:storybook-button--secondary={!primary}
	style:background-color={backgroundColor}
	{onclick}
>
	{label}
</button>
