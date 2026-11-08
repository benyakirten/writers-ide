import { Fragment } from 'prosemirror-model';
import { schema } from './schema';

export const mediumPage = schema.node('page', null, [
	schema.node('paragraph', null, [
		schema.text('8Lorem ipsum dolor sit amet, consectetur adipiscing elit.'),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'9Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus. Donec pellentesque, tellus sodales accumsan rhoncus, massa tortor cursus mi, vel pellentesque eros enim eleifend ligula. Suspendisse potenti. Donec some stuff here id please do not copy. Something or other. Donec nec nunc id ligula efficitur fringilla. Sed ut erat a enim tincidunt facilisis. Donec some other words id something not identical. A final bit to complete this stuff.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'10Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
]);

export const longPage = schema.node('page', null, [
	schema.node('paragraph', null, [
		schema.text('8Lorem ipsum dolor sit amet, consectetur adipiscing elit.'),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'9Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus. Donec pellentesque, tellus sodales accumsan rhoncus, massa tortor cursus mi, vel pellentesque eros enim eleifend ligula. Suspendisse potenti. Donec some stuff here id please do not copy. Something or other. Donec nec nunc id ligula efficitur fringilla. Sed ut erat a enim tincidunt facilisis. Donec some other words id something not identical. A final bit to complete this stuff.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'10Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'11Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'12Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'13Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'14Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'15Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
]);

const longPageWithBreak = schema.node('page', null, [
	schema.node('paragraph', null, [
		schema.text('8Lorem ipsum dolor sit amet, consectetur adipiscing elit.'),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'9Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus. Donec pellentesque, tellus sodales accumsan rhoncus, massa tortor cursus mi, vel pellentesque eros enim eleifend ligula. Suspendisse potenti. Donec some stuff here id please do not copy. Something or other. Donec nec nunc id ligula efficitur fringilla. Sed ut erat a enim tincidunt facilisis. Donec some other words id something not identical. A final bit to complete this stuff.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'10Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
	schema.node('pageEnd'),
	schema.node('paragraph', null, [
		schema.text(
			'11Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'12Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'13Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'14Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'15Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
]);

export const multiplePages = [longPage];
for (let i = 0; i < 2; i++) {
	multiplePages.push(longPage);
	multiplePages.push(longPageWithBreak);
}

export const shortPage = schema.node('page', null, [
	schema.node('paragraph', null, [schema.text('Short page content.')]),
]);

export const shortPageInterrupted = schema.node('page', null, [
	schema.node('paragraph', null, [schema.text('Short page content.')]),
	schema.node('pageEnd'),
]);

export const mediumPageInterrupted = schema.node('page', null, [
	schema.node('paragraph', null, [
		schema.text('8Lorem ipsum dolor sit amet, consectetur adipiscing elit.'),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'9Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus. Donec pellentesque, tellus sodales accumsan rhoncus, massa tortor cursus mi, vel pellentesque eros enim eleifend ligula. Suspendisse potenti. Donec some stuff here id please do not copy. Something or other. Donec nec nunc id ligula efficitur fringilla. Sed ut erat a enim tincidunt facilisis. Donec some other words id something not identical. A final bit to complete this stuff.',
		),
	]),
	schema.node('pageEnd'),
	schema.node('paragraph', null, [
		schema.text(
			'10Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
]);

export const emptyPage = schema.node('page', null, [schema.node('paragraph', null, [])]);

export const shortPages = [shortPage, shortPage, shortPageInterrupted, shortPage, shortPage];

export const barelyTooLongPage = schema.node('page', null, [
	schema.node('paragraph', null, [
		schema.text(
			'6Lorem ipsum dolor sit amet, consectetur adipiscing elit.  consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'7Lorem ipsum dolor sit amet, consectetur adipiscing elit.  consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus',
		),
	]),
	schema.node('paragraph', null, [
		schema.text('8Lorem ipsum dolor sit amet, consectetur adipiscing elit.'),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'9Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus. Donec pellentesque, tellus sodales accumsan rhoncus, massa tortor cursus mi, vel pellentesque eros enim eleifend ligula. Suspendisse potenti. Donec some stuff here id please do not copy. Something or other. Donec nec nunc id ligula efficitur fringilla. Sed ut erat a enim tincidunt facilisis. Donec some other words id something not identical. A final bit to complete this stuff.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'10Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed lu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
	schema.node('paragraph', null, [
		schema.text(
			'11Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed lu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.',
		),
	]),
	schema.node('pageEnd'),
]);

const paginationCases = [
	{
		name: 'Underflow: three short source pages should merge',
		pages: [shortPage, shortPage, shortPage],
	},
	{ name: 'Overflow: long content should span several pages', pages: [longPage] },
	{ name: 'Near-boundary overflow and paragraph splitting', pages: [barelyTooLongPage] },
	{ name: 'Explicit break with content after it', pages: [mediumPageInterrupted] },
	{ name: 'Long content with an internal explicit break', pages: [longPageWithBreak] },
	{
		name: 'Empty source pages between content',
		pages: [shortPage, emptyPage, emptyPage, mediumPage],
	},
	{
		name: 'Consecutive explicit breaks should keep short pages separate',
		pages: [shortPageInterrupted, shortPageInterrupted, shortPageInterrupted],
	},
	{
		name: 'Mixed short, medium, and overflowing source pages',
		pages: [shortPage, mediumPage, longPage, shortPage],
	},
	{ name: 'Leading and trailing empty source pages', pages: [emptyPage, mediumPage, emptyPage] },
	{ name: 'Several overflowing source pages', pages: multiplePages },
];

/** Source-case numbers survive reflow; they are deliberately not physical page numbers. */
export const paginationSampleDocument = schema.node(
	'doc',
	null,
	Array.from({ length: 2 }, (_, round) =>
		paginationCases.flatMap((sample, caseIndex) => {
			const caseNumber = String(round * paginationCases.length + caseIndex + 1).padStart(2, '0');
			let paragraphNumber = 0;
			return sample.pages.map((page, pageIndex) => {
				const blocks = Array.from(page.content.content).map((block) => {
					if (block.type.name !== 'paragraph' || block.content.size === 0) {
						return block;
					}
					paragraphNumber++;
					const label = schema.text(`[${caseNumber}.${String(paragraphNumber).padStart(2, '0')}] `);
					return block.copy(Fragment.from(label).append(block.content));
				});
				if (pageIndex === 0) {
					blocks.unshift(
						schema.node(
							'paragraph',
							null,
							schema.text(
								`CASE ${caseNumber} — ${sample.name}. Paragraph labels identify source order, not page numbers.`,
							),
						),
					);
				}
				// Isolate cases, while allowing content to flow between source pages inside a case.
				if (pageIndex === sample.pages.length - 1 && blocks.at(-1)?.type.name !== 'pageEnd') {
					blocks.push(schema.node('pageEnd'));
				}
				return schema.node('page', null, blocks);
			});
		}),
	).flat(),
);
