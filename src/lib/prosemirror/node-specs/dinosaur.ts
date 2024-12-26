import { Schema, DOMParser, type NodeSpec } from 'prosemirror-model';
import { schema } from 'prosemirror-schema-basic';
import { MenuItem } from 'prosemirror-menu';
import { buildMenuItems } from 'prosemirror-example-setup';
import type { EditorState } from 'prosemirror-state';

// The supported types of dinosaurs.
export const dinos = ['brontosaurus', 'stegosaurus', 'triceratops', 'tyrannosaurus', 'pterodactyl'];

export const dinoNodeSpec: NodeSpec = {
	// Dinosaurs have one attribute, their type, which must be one of
	// the types defined above.
	// Brontosaurs are still the default dino.
	attrs: { type: { default: 'brontosaurus' } },
	inline: true,
	group: 'inline',
	draggable: true,

	// These nodes are rendered as images with a `dino-type` attribute.
	// There are pictures for all dino types under /img/dino/.
	toDOM: (node) => [
		'img',
		{
			'dino-type': node.attrs.type,
			src: `https://prosemirror.net/img/dino/${node.attrs.type}.png`,
			title: node.attrs.type,
			class: 'dinosaur'
		}
	],
	// When parsing, such an image, if its type matches one of the known
	// types, is converted to a dino node.
	parseDOM: [
		{
			tag: 'img[dino-type]',
			getAttrs: (dom: HTMLElement) => {
				const type = dom.getAttribute('dino-type');
				return dinos.indexOf(type ?? '') > -1 ? { type } : false;
			}
		}
	]
};

export const dinoSchema = new Schema({
	nodes: schema.spec.nodes.addBefore('image', 'dino', dinoNodeSpec),
	marks: schema.spec.marks
});

export const startDoc = (el: HTMLElement) => DOMParser.fromSchema(dinoSchema).parse(el);

export const dinoType = dinoSchema.nodes.dino;

export function insertDino(type: string) {
	return function (state: EditorState, dispatch) {
		const { $from } = state.selection,
			index = $from.index();
		if (!$from.parent.canReplaceWith(index, index, dinoType)) return false;
		if (dispatch) dispatch(state.tr.replaceSelectionWith(dinoType.create({ type })));
		return true;
	};
}

// Ask example-setup to build its basic menu
export const menu = buildMenuItems(dinoSchema);
// Add a dino-inserting item for each type of dino
dinos.forEach((name) =>
	menu.insertMenu.content.push(
		new MenuItem({
			title: 'Insert ' + name,
			label: name.charAt(0).toUpperCase() + name.slice(1),
			enable(state) {
				return insertDino(name)(state);
			},
			run: insertDino(name)
		})
	)
);
