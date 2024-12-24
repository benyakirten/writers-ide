export type BlockProperty = string;

export type BaseBlockData = {
	classes: string[];
	properties: Record<string, string>;
	id: string;
	content: string;
};

export type Blocks = BlockData[];
export type BlockData =
	| BreakData
	| DivData
	| ListData
	| TextData
	| ParagraphData
	| ImageData
	| TableData
	| LinkData;

export type BlockProps = {
	index: number;
	block: BlockData;
	updateBlockContent: (index: number, content: string) => void;
	addBlock: (content: string) => void;
};

export type DivData = BaseBlockData & {
	type: 'div';
	data: DivData;
	children: BlockProps[];
};

export type DivProps = DivData & {
	// updateBlockContent: (index: number, content: string) => void;
};

export type BreakData = BaseBlockData & {
	type: 'br';
};

export type BreakProps = BreakData;

export type ListData = BaseBlockData & {
	type: 'ul' | 'ol';
	data: Blocks;
};

export type ListProps = ListData;

export type TextData = BaseBlockData & {
	type: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'span' | 'pre' | 'code' | 'var';
	content: string;
};
export type TextProps = TextData & {
	// updateBlockContent: (content: string) => void;
};

export type ParagraphData = BaseBlockData &
	Omit<TextProps, 'type'> & {
		type: 'p';
		children: TextProps[];
	};

export type ParagraphProps = ParagraphData & {
	updateBlockContent: (content: string) => void;
	addBlock: (content: string) => void;
};

export type ImageData = BaseBlockData & {
	type: 'img';
	data: {
		url: string;
		alt: string;
	};
};

export type ImageProps = ImageData;

export type TableData = BaseBlockData & {
	type: 'table';
	data: {
		content: string | null;
		children: TablePartData[];
	};
};

export type TablePartData = {
	type: 'thead' | 'tbody' | 'tfoot';
	children: TableRowProps[];
	classes: string[];
	properties: Record<string, string>;
};

export type TableRowProps = BaseBlockData & {
	type: 'tr';
	data: TableRowData;
};

export type TableRowData = {
	children: TableCellProps[];
};

export type TableCellProps = BaseBlockData & {
	type: 'th' | 'td';
	data: TableCellData;
};

export type TableCellData = {
	content: string;
};

export type LinkData = BaseBlockData & {
	type: 'a';
	data: {
		content: string;
		href: string;
	};
};

export type LinkProps = LinkData;
