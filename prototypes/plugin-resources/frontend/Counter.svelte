<script>
	let count = $state(0);
</script>

<button
	data-counter
	onclick={() => {
		count += 1;
	}}>Count: {count}</button
>
