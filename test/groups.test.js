/* M1: the symmetry engine. These turn the measurements in
   tools/measurements/ (docs/from3Dto2D.md §3–§4) into assertions. */
import { test } from 'node:test';

test.todo('element codes: compose, inverse and isReflection agree with the matrices');
test.todo('closure of each SUBGROUPS entry has the expected order (1,2,2,2,2,2,4,4,4,8)');
test.todo('D4 has 10 subgroups in 8 conjugacy classes');
test.todo('orbit counts at 16x16 and 8x8 match from3Dto2D.md §4');
test.todo('every orbit has exactly one representative, every group, every grid 2x2..40x40');
test.todo('aut(sprite) >= |G| for every group at every size (fold:2)');
test.todo('effectiveGroup: rot90 on a rectangle reduces to rot180 and reports reduced:true');
test.todo('fold:1 reproduces the old defects exactly (rot180 odd h, rot90 odd and non-square)');
test.todo('fold:2 picks the legacy representative wherever the old fold was exact');
