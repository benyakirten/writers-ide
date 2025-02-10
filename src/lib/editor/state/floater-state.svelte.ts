type FloatIngPosition = {
	type: 'floating';
	left: number;
	right: number;
	top: number;
	bottom: number;
};

type FullHeightPosition = {
	type: 'full';
	left: number;
	right: number;
};

export type FloatingBar = {
	position: FloatIngPosition | FullHeightPosition;
	data?: null;
	z?: number;
};

class FloaterState {
	bars = $state<FloatingBar[]>([]);
}

const floaterState = new FloaterState();
export default floaterState;
