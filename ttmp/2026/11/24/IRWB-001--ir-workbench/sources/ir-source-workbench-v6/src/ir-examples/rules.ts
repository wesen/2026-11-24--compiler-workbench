/** These are actual transformation programs consumed by the generic layer-three engine. */
import { capture, distinct, entity as isEntity, equalContent, op, pattern, sameAs, where, PatternPredicateRegistry } from '../ir/patterns.js';
import { rewrite } from '../ir/rewrites.js';
import type { IREdit, IRView } from '../ir/types.js';
import { entity, relationId } from './common.js';
import { EXPRESSION_ROOT, type ExpressionProgram } from './expressions.js';
import { type NativeScene } from './scenes.js';
import { CONSTRAINT_ROOT, normalizedEquation, type ConstraintSystem } from './constraints.js';
export const duplicateExpressionPattern = pattern({
    keep: isEntity(), drop: isEntity()
}).where(distinct('keep', 'drop')).where(equalContent('keep', 'drop'));
export const doubledExpressionPattern = pattern(capture('sum', op('add', capture('term'), sameAs('term'))));
export const duplicateDefinitionPattern = pattern({
    keep: isEntity('scene.definition'), drop: isEntity('scene.definition')
}).where(distinct('keep', 'drop')).where(equalContent('keep', 'drop'));
export const duplicateConstraintPattern = pattern({
    keep: isEntity('constraints.equation'), drop: isEntity('constraints.equation')
}).where(distinct('keep', 'drop')).where(where({
    id: 'ir-lab.constraint.same-normalized-row', version: '1'
}));
export const predicateRegistry = new PatternPredicateRegistry().register<ConstraintSystem, unknown>({
    id: 'ir-lab.constraint.same-normalized-row', version: '1', description: 'Compare complete sparse equation coefficients and right-hand sides after normalization', test({ view, bindings }) {
        const a = view.artifact.value.equations.find(e => e.id === bindings.keep.entity)!, b = view.artifact.value.equations.find(e => e.id === bindings.drop.entity)!;
        return {
            pass: normalizedEquation(a) === normalizedEquation(b), reason: 'Normalized complete sparse rows must agree'
        };
    }
});
export const expressionCSE = rewrite<ExpressionProgram>({
    id: 'ir-lab.expression.cse', version: '1', description: 'Merge duplicate operations with identical ordered operands or identical atomic values', match: duplicateExpressionPattern, guard(match) {
        return {
            accept: match.bindings.keep.entity < match.bindings.drop.entity, reason: 'Retain the lexicographically first stable operation identity'
        };
    }, replace(match, edit) {
        const { keep, drop } = match.bindings;
        edit.redirectReferences(drop, keep);
        edit.remove(drop);
        edit.correspond([keep, drop], keep, 'common-subexpression');
    }, preserves: [{
            id: 'ir-lab.expression.equivalent', version: '1'
        }]
});
export const expressionDouble = rewrite<ExpressionProgram>({
    id: 'ir-lab.expression.double', version: '1', description: 'Rewrite x + x into 2 × x, retaining the output operation identity', match: doubledExpressionPattern, replace(match, edit, view) {
        const sum = match.bindings.sum, term = match.bindings.term;
        let two = view.find(e => e.kind === 'expression.constant' && e.attributes.value === 2)[0];
        if (!two) {
            const id = `two/${sum.entity}`;
            two = edit.insert(entity(id, 'expression.constant', { value: 2 }));
            edit.connect(EXPRESSION_ROOT, {
                id: relationId('contains', EXPRESSION_ROOT, id), kind: 'contains'
            }, id);
        }
        for (const r of edit.preview().relations.filter(r => r.kind === 'operand' && r.from === sum.entity))
            edit.disconnect(r.id);
        edit.replace(sum, entity(sum.entity, 'expression.mul'));
        edit.connect(sum, {
            id: relationId('operand', sum.entity, two.entity, 0), kind: 'operand', order: 0
        }, two);
        edit.connect(sum, {
            id: relationId('operand', sum.entity, term.entity, 1), kind: 'operand', order: 1
        }, term);
        edit.correspond(sum, sum, 'algebraic-double');
    }, preserves: [{
            id: 'ir-lab.expression.equivalent', version: '1'
        }]
});
export const sceneSharing = rewrite<NativeScene>({
    id: 'ir-lab.scene.share-definitions', version: '1', description: 'Share one native definition while retaining each independent instance placement', match: duplicateDefinitionPattern, guard(match) {
        return {
            accept: match.bindings.keep.entity < match.bindings.drop.entity, reason: 'Retain the first stable definition identity'
        };
    }, replace(match, edit) {
        const { keep, drop } = match.bindings;
        edit.redirectReferences(drop, keep, { relations: ['uses'] });
        edit.remove(drop);
        edit.correspond([keep, drop], keep, 'shared-definition');
    }, preserves: [{
            id: 'ir-lab.scene.placements-equivalent', version: '1'
        }]
});
export const redundantConstraint = rewrite<ConstraintSystem>({
    id: 'ir-lab.constraints.remove-redundant-row', version: '1', description: 'Remove a scaled duplicate equation after comparing all sparse coefficients and the right-hand side', match: duplicateConstraintPattern, guard(match) {
        return {
            accept: match.bindings.keep.entity < match.bindings.drop.entity, reason: 'Keep the first normalized equation identity'
        };
    }, replace(match, edit) {
        const { keep, drop } = match.bindings;
        edit.remove(drop);
        edit.correspond([keep, drop], keep, 'redundant-equation');
    }, preserves: [{
            id: 'ir-lab.constraints.solution-equivalent', version: '1'
        }]
});
export function selectComponentSolver(edit: IREdit<ConstraintSystem>, view: IRView<ConstraintSystem>): void {
    edit.update(CONSTRAINT_ROOT, { solver: 'components' });
    edit.correspond(view.ref(CONSTRAINT_ROOT), CONSTRAINT_ROOT, 'solver-substitution');
}
