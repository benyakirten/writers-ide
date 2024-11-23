export type Word = {
	word: string;
};
export type BlockDatum = {
	words: Word[];
};
export type BlockData = BlockDatum[];

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
};
