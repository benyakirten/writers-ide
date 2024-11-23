/**
 * The node of the rope data structure
 */
type RopeNode = {
	left: RopeNode | null;
	right: RopeNode | null;
	weight: number;
	value: string | null;
	height: number; // Used to balance the tree
};

/**
 * A rope contains a sequence of characters and is optimized for
 * quick insertions/deletions at random points inside of the text.
 * It is implemented as a binary tree that balances itself.
 */
class Rope {
	private root: RopeNode | null;

	constructor(initialText: string = '') {
		this.root = initialText ? this.createLeafNode(initialText) : null;
	}

	private createLeafNode(value: string): RopeNode {
		return {
			left: null,
			right: null,
			weight: value.length,
			value,
			height: 1
		};
	}

	/**
	 * Insert text at a specific position in the rope and then rebalance it.
	 */
	public insert(position: number, text: string): Rope {
		this.root = this.insertNode(this.root, position, text);
		return this;
	}

	// Split the rope at a specific position into two ropes.
	public split(position: number): [RopeNode | null, RopeNode | null] {
		return this.splitNode(this.root, position);
	}

	// Delete a range of text then rebalance the rope.
	public delete(start: number, end: number): Rope {
		this.root = this.deleteRange(this.root, start, end);
		return this;
	}

	private insertNode(node: RopeNode | null, position: number, text: string): RopeNode {
		if (!node) {
			return this.createLeafNode(text);
		}

		if (node.value !== null) {
			const [left, right] = this.splitNode(node, position);
			const newLeft = this.mergeNodes(left, this.createLeafNode(text));
			return this.mergeNodes(newLeft, right);
		}

		if (position <= node.weight) {
			node.left = this.insertNode(node.left, position, text);
		} else {
			node.right = this.insertNode(node.right, position - node.weight, text);
		}

		this.updateWeight(node);
		return this.balance(node);
	}

	/**
	 * Splits a given RopeNode at the specified position into two separate nodes. It returns
	 * a tuple containing two RopeNodes. The first element is the left part of the split node,
	 * and the second element is the right part of the split node. If the input node is null, both elements
	 * of the tuple will be null.
	 */
	private splitNode(node: RopeNode | null, position: number): [RopeNode | null, RopeNode | null] {
		if (!node) {
			return [null, null];
		}

		if (node.value !== null) {
			const left = node.value.slice(0, position);
			const right = node.value.slice(position);
			return [this.createLeafNode(left), this.createLeafNode(right)];
		}

		if (position <= node.weight) {
			const [left, mid] = this.splitNode(node.left, position);
			return [left, this.mergeNodes(mid, node.right)];
		} else {
			const [mid, right] = this.splitNode(node.right, position - node.weight);
			return [this.mergeNodes(node.left, mid), right];
		}
	}

	/**
	 * Given two RopeNodes, merge them into a single RopeNode by concatenating their internal values.
	 * If either of the nodes is null, the other is returned as is.
	 * If both are null, a new empty leaf node is created.
	 */
	private mergeNodes(left: RopeNode | null, right: RopeNode | null): RopeNode {
		if (!left && !right) {
			return this.createLeafNode('');
		}

		if (!left) return right as RopeNode;
		if (!right) return left as RopeNode;

		// Merge left and right by concatenating their string representation
		return this.createLeafNode(this.flatten(left) + this.flatten(right));
	}

	/**
	 * Separates the rope into three parts:
	 * 1. The left part (prior to the start index)
	 * 2. The middle part (from the start to the end index)
	 * 3. The right part (after the end index)
	 * Returns the left and right parts with the middle ommitted.
	 */
	private deleteRange(node: RopeNode | null, start: number, end: number): RopeNode | null {
		if (!node) return null;

		const [left, midRight] = this.splitNode(node, start);
		const [, right] = this.splitNode(midRight, end - start);

		return this.mergeNodes(left, right);
	}

	/**
	 * Get the string representation of the rope starting from the root.
	 */
	toString(): string {
		return this.flatten(this.root);
	}

	/**
	 * Flatten the rope tree into a single string by recursively
	 * concatenating the text in the left node to the right node.
	 */
	private flatten(node: RopeNode | null): string {
		if (!node) return '';
		if (node.value !== null) return node.value;
		return this.flatten(node.left) + this.flatten(node.right);
	}

	private balance(node: RopeNode): RopeNode {
		this.updateHeight(node);

		const balanceFactor = this.balanceFactor(node);

		// Left heavy
		if (balanceFactor > 1) {
			if (this.balanceFactor(node.left!) < 0) {
				node.left = this.rotateLeft(node.left!);
			}
			return this.rotateRight(node);
		}

		// Right heavy
		if (balanceFactor < -1) {
			if (this.balanceFactor(node.right!) > 0) {
				node.right = this.rotateRight(node.right!);
			}
			return this.rotateLeft(node);
		}

		return node;
	}

	// AVL Balancing - https://www.geeksforgeeks.org/introduction-to-avl-tree/
	// See https://www.cs.usfca.edu/~galles/visualization/AVLtree.html for a visualization

	private height(node: RopeNode | null): number {
		return node ? node.height : 0;
	}

	private updateWeight(node: RopeNode): void {
		node.weight = node.left ? this.flatten(node.left).length : 0;
	}

	private updateHeight(node: RopeNode): void {
		node.height = Math.max(this.height(node.left), this.height(node.right)) + 1;
	}

	private balanceFactor(node: RopeNode): number {
		return this.height(node.left) - this.height(node.right);
	}

	private rotateRight(y: RopeNode): RopeNode {
		const x = y.left!;
		y.left = x.right;
		x.right = y;

		this.updateWeight(y);
		this.updateWeight(x);

		this.updateHeight(y);
		this.updateHeight(x);

		return x;
	}

	private rotateLeft(x: RopeNode): RopeNode {
		const y = x.right!;
		x.right = y.left;
		y.left = x;

		this.updateWeight(x);
		this.updateWeight(y);

		this.updateHeight(x);
		this.updateHeight(y);

		return y;
	}
}

export default Rope;
