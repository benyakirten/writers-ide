import { Schema } from 'prosemirror-model';
import { nodes } from './nodes.js';
import { marks } from './marks.js';

export const schema = new Schema({ nodes, marks });
