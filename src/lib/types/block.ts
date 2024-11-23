// TODO: Fill this out
export type BlockProperty = string;

export type BlockData = {
	content: string | null;
	children: BlockProps[];
	classes: string[];
	properties: Record<string, string>;
};

export type BlockType =
	| 'p'
	| 'h1'
	| 'h2'
	| 'h3'
	| 'h4'
	| 'h5'
	| 'h6'
	| 'ul'
	| 'ol'
	| 'li'
	| 'blockquote'
	| 'pre'
	| 'code'
	| 'img'
	| 'a'
	| 'hr'
	| 'br'
	| 'table'
	| 'thead'
	| 'tbody'
	| 'tr'
	| 'th'
	| 'td';

export type BlockProps = {
	type: BlockType;
	data: BlockData;
	id: string;
};
