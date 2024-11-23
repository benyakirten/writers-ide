export type BlockProperty = string;

type BaseProperties = {
	classes: string[];
	properties: Record<string, string>;
};

export type BlockProps =
	| BreakProps
	| DivProps
	| ListProps
	| TextProps
	| ImageProps
	| TableProps
	| LinkProps;

export type DivProps = {
	type: 'div';
	data: DivData;
	id: string;
};

export type DivData = BaseProperties & {
	children: BlockProps[];
};

export type BreakProps = {
	type: 'br';
	id: string;
};

export type ListProps = {
	type: 'ul' | 'ol';
	data: BlockProps[];
	id: string;
};

export type ListData = {
	children: ListItemProps[];
	classes: string[];
	properties: Record<string, string>;
};

export type ListItemProps = {
	type: 'li';
	id: string;
} & ({ data: BlockProps } | { content: string });

export type TextProps = {
	type: 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'span' | 'pre' | 'code' | 'var';
	data: TextData;
	id: string;
};

export type TextData = BaseProperties & {
	content: string;
};

export type ImageProps = {
	type: 'img';
	data: ImageData;
	id: string;
};

export type ImageData = BaseProperties & {
	url: string;
	alt: string;
};

export type TableProps = {
	type: 'table';
	data: TableData;
	id: string;
};

export type TableData = BaseProperties & {
	content: string | null;
	children: TablePartData[];
};

export type TablePartData = {
	type: 'thead' | 'tbody' | 'tfoot';
	children: TableRowProps[];
	classes: string[];
	properties: Record<string, string>;
};

export type TableRowProps = {
	type: 'tr';
	data: TableRowData;
	id: string;
};

export type TableRowData = BaseProperties & {
	children: TableCellProps[];
};

export type TableCellProps = {
	type: 'th' | 'td';
	data: TableCellData;
	id: string;
};

export type TableCellData = BaseProperties & {
	content: string;
};

export type LinkProps = {
	type: 'a';
	data: LinkData;
	id: string;
};

export type LinkData = BaseProperties & {
	content: string;
	href: string;
};
