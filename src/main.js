/* Composition root. M2 wires recipe -> generate -> rasterize -> view here.
   For now it only proves the module graph loads in the browser. */
import { SUBGROUPS } from './core/groups2d.js';
import { DEFAULT_RECIPE } from './recipe/schema.js';

const status = document.getElementById('status');
if (status) {
  status.textContent =
    `spritesnow scaffold: modules load (${SUBGROUPS.length} symmetry groups declared, ` +
    `recipe format ${DEFAULT_RECIPE.format}). Nothing is implemented yet; see docs/newdesign.md §6.`;
}
