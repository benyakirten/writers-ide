import { schema } from './schema';

const longPage = schema.node('page', null, [
	schema.node('paragraph', null, [
		schema.text('8Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
	]),
	schema.node('paragraph', null, [
		schema.text(
			'9Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus. Donec pellentesque, tellus sodales accumsan rhoncus, massa tortor cursus mi, vel pellentesque eros enim eleifend ligula. Suspendisse potenti. Donec some stuff here id please do not copy. Something or other. Donec nec nunc id ligula efficitur fringilla. Sed ut erat a enim tincidunt facilisis. Donec some other words id something not identical. A final bit to complete this stuff.'
		)
	]),
	schema.node('paragraph', null, [
		schema.text(
			'10Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.'
		)
	]),
	schema.node('paragraph', null, [
		schema.text(
			'11Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.'
		)
	]),
	schema.node('paragraph', null, [
		schema.text(
			'12Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.'
		)
	]),
	schema.node('paragraph', null, [
		schema.text(
			'13Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.'
		)
	]),
	schema.node('paragraph', null, [
		schema.text(
			'14Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.'
		)
	]),
	schema.node('paragraph', null, [
		schema.text(
			'15Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi consequat viverra lacus non maximus. Nunc vestibulum semper sodales. Mauris feugiat tortor et auctor malesuada. Phasellus nisi quam, lacinia et malesuada a, pulvinar a leo. Sed eu hendrerit felis. Sed ut ipsum accumsan, ullamcorper lorem id, eleifend risus.'
		)
	])
]);

export const multiplePages = [longPage];
for (let i = 0; i < 100; i++) {
	multiplePages.push(longPage);
}

const shortPage = schema.node('page', null, [
	schema.node('paragraph', null, [schema.text('Short page content.')])
]);

const shortPageInterrupted = schema.node('page', null, [
	schema.node('paragraph', null, [schema.text('Short page content.')]),
	schema.node('pageEnd')
]);

export const shortPages = [
	shortPage,
	shortPage,
	shortPage,
	shortPageInterrupted,
	shortPage,
	shortPage
];
