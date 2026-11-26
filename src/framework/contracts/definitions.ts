import {
  canonical,
  deepFreeze,
  fingerprint,
  immutable,
  isCanonical,
  revisionOf,
  validateOnce,
} from '../core/data.js';
import type { Artifact } from '../core/types.js';
import type {
  AnalysisDefinition,
  AnyDefinition,
  CheckResult,
  DefinitionDescriptor,
  EffectDefinition,
  IRType,
  InvariantDefinition,
  ObjectiveDefinition,
  Ports,
  PropertyDefinition,
  TransformationDefinition,
  ValueType,
  VersionRef,
} from './types.js';
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function portType(value: unknown, category?: 'ir' | 'type'): asserts value is IRType<any> | ValueType<any> {
  if (
    !value ||
    typeof value !== 'object' ||
    !['ir', 'type'].includes(
      (
        value as {
          category: string;
        }
      ).category,
    ) ||
    (category &&
      (
        value as {
          category: string;
        }
      ).category !== category) ||
    typeof (
      value as {
        validate?: unknown;
      }
    ).validate !== 'function'
  )
    throw new Error(`Expected ${category ?? 'IR or scalar'} type with runtime validator`);
}
function ports(value: unknown): asserts value is Ports {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected named port definitions');
  for (const [name, type] of Object.entries(value)) {
    if (!nonempty(name)) throw new Error('Port name required');
    portType(type);
  }
}
function base<
  T extends {
    id: string;
    version: string;
    description: string;
  },
>(value: T): T {
  if (!nonempty(value.id) || !nonempty(value.version) || typeof value.description !== 'string')
    throw new Error('Definitions need id, version and description');
  return deepFreeze(value);
}
export const defineType = <T>(d: Omit<ValueType<T>, 'category'>): ValueType<T> => {
  if (typeof d.validate !== 'function') throw new Error('Type requires a runtime validator');
  return base({
    ...d,
    category: 'type',
  });
};
export const defineIR = <T>(d: Omit<IRType<T>, 'category'>): IRType<T> => {
  if (typeof d.validate !== 'function') throw new Error('IR requires a runtime validator');
  return base({
    ...d,
    category: 'ir',
  });
};
export const defineEffect = <T>(d: Omit<EffectDefinition<T>, 'category'>): EffectDefinition<T> => {
  portType(d.type, 'type');
  if (!nonempty(d.resource) || !['read', 'write'].includes(d.access))
    throw new Error('Effect needs resource and read/write access');
  return base({
    ...d,
    category: 'effect',
  });
};
export const defineAnalysis = <S, R>(
  d: Omit<AnalysisDefinition<S, R>, 'category' | 'effects'> & {
    effects?: readonly EffectDefinition[];
  },
): AnalysisDefinition<S, R> => {
  portType(d.input, 'ir');
  portType(d.output, 'type');
  if (typeof d.run !== 'function') throw new Error('Analysis needs run');
  if (
    d.transfer &&
    (!nonempty(d.transfer.id) || !nonempty(d.transfer.version) || typeof d.transfer.verify !== 'function')
  )
    throw new Error('Analysis transfer needs exact rule identity and verifier');
  if (d.effects?.some(e => e.access === 'write')) throw new Error('Analyses cannot declare write effects');
  return base({
    ...d,
    effects: d.effects ?? [],
    category: 'analysis',
  });
};
export const defineProperty = <S>(d: Omit<PropertyDefinition<S>, 'category'>): PropertyDefinition<S> => {
  portType(d.subject, 'ir');
  if (!d.check || d.check.category !== 'analysis') throw new Error('Property needs an analysis checker');
  if (
    d.proofVerifier &&
    (d.proofVerifier.input.id !== d.subject.id || d.proofVerifier.input.version !== d.subject.version)
  )
    throw new Error('Proof verifier input must match property subject IR');
  if (d.subject.id !== d.check.input.id || d.subject.version !== d.check.input.version)
    throw new Error('Property checker input must match its subject IR');
  return base({
    ...d,
    category: 'property',
  });
};
export const defineInvariant = <P extends Ports>(
  d: Omit<InvariantDefinition<P>, 'category' | 'effects'> & {
    effects?: readonly EffectDefinition[];
  },
): InvariantDefinition<P> => {
  ports(d.inputs);
  if (typeof d.check !== 'function') throw new Error('Invariant needs a checker');
  if (d.effects?.some(e => e.access === 'write')) throw new Error('Invariants cannot declare write effects');
  return base({
    ...d,
    effects: d.effects ?? [],
    category: 'invariant',
  });
};
export const defineObjective = <S>(d: Omit<ObjectiveDefinition<S>, 'category'>): ObjectiveDefinition<S> => {
  if (!['min', 'max'].includes(d.direction)) throw new Error('Objective direction must be min/max');
  return base({
    ...d,
    category: 'objective',
  });
};
export function defineTransformation<I extends Ports, O extends Ports>(
  d: Omit<
    TransformationDefinition<I, O>,
    'category' | 'requires' | 'preserves' | 'ensures' | 'establishes' | 'effects' | 'cache' | 'correspondence'
  > &
    Partial<
      Pick<
        TransformationDefinition<I, O>,
        'requires' | 'preserves' | 'ensures' | 'establishes' | 'effects' | 'cache' | 'correspondence'
      >
    >,
): TransformationDefinition<I, O> {
  ports(d.inputs);
  ports(d.outputs);
  if (d.run !== undefined && typeof d.run !== 'function')
    throw new Error('Transformation run must be a function');
  const result = base({
    ...d,
    category: 'transformation' as const,
    requires: d.requires ?? [],
    preserves: d.preserves ?? [],
    ensures: d.ensures ?? [],
    establishes: d.establishes ?? [],
    effects: d.effects ?? [],
    cache: d.cache ?? 'pure',
    correspondence: d.correspondence ?? [],
  });
  if (result.cache === 'pure' && result.effects.length)
    throw new Error('Pure transformation cannot declare resource effects');
  if (result.cache !== 'never' && result.effects.some(e => e.access === 'write'))
    throw new Error('Write effects require cache: never');
  if (!['pure', 'tracked', 'never'].includes(result.cache)) throw new Error('Invalid cache policy');
  const selector = (
    s: {
      from: 'inputs' | 'outputs';
      port: string;
    },
    pre = false,
  ) => {
    if (!s || !['inputs', 'outputs'].includes(s.from) || !nonempty(s.port))
      throw new Error('Invalid contract port selector');
    if (pre && s.from === 'outputs') throw new Error('Preconditions cannot refer to outputs');
    const ports = s.from === 'inputs' ? result.inputs : result.outputs;
    if (!Object.hasOwn(ports, s.port)) throw new Error(`Unknown ${s.from} port ${s.port}`);
    return ports[s.port];
  };
  for (const [phase, conditions] of [
    ['requires', result.requires],
    ['ensures', result.ensures],
    ['establishes', result.establishes],
  ] as const)
    for (const c of conditions) {
      if ('property' in c) {
        const type = selector(c.subject, phase === 'requires');
        if (
          type.category !== 'ir' ||
          type.id !== c.property.subject.id ||
          type.version !== c.property.subject.version
        )
          throw new Error(`Property ${c.property.id} is incompatible with port ${c.subject.port}`);
      } else {
        for (const [name, type] of Object.entries(c.invariant.inputs as Ports)) {
          const s = c.bindings[name];
          if (!s) throw new Error(`Missing invariant binding ${name}`);
          const bound = selector(s, phase === 'requires');
          if (bound.category !== type.category || bound.id !== type.id || bound.version !== type.version)
            throw new Error(`Invariant port ${name} is incompatible`);
        }
        if (Object.keys(c.bindings).length !== Object.keys(c.invariant.inputs).length)
          throw new Error('Unexpected invariant bindings');
      }
    }
  for (const p of result.preserves) {
    const from = result.inputs[p.from],
      to = result.outputs[p.to];
    if (
      !from ||
      !to ||
      from.category !== 'ir' ||
      to.category !== 'ir' ||
      from.id !== p.property.subject.id ||
      to.id !== p.property.subject.id ||
      from.version !== p.property.subject.version ||
      to.version !== p.property.subject.version
    )
      throw new Error(`Preservation ${p.property.id} needs compatible IR input/output ports`);
    if (!['check', 'transfer'].includes(p.mode)) throw new Error('Preservation mode must be check/transfer');
    if (p.mode === 'transfer' && (!p.correspondence || !p.property.check.transfer))
      throw new Error('Transfer preservation needs a correspondence and registered transfer checker');
  }
  for (const c of result.correspondence) {
    if (result.inputs[c.from]?.category !== 'ir' || result.outputs[c.to]?.category !== 'ir')
      throw new Error('Correspondence requirements need IR input/output ports');
  }
  return result;
}
export const definitionRef = (d: VersionRef): VersionRef => ({
  id: d.id,
  version: d.version,
});
function shape(v: unknown): unknown {
  if (typeof v === 'function') return '[implementation]';
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === 'object') {
    if ('category' in v && 'id' in v && 'version' in v) return definitionRef(v as VersionRef);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  }
  return v;
}
export function describeDefinition(d: AnyDefinition): DefinitionDescriptor {
  const { id, version, description, category, ...other } = d;
  return immutable({
    id,
    version,
    description,
    category,
    schema: shape(other),
  });
}
export function createArtifact<T>(ir: IRType<T>, id: string, value: T): Artifact<T> {
  if (!nonempty(id)) throw new Error('Artifact id required');
  const captured = immutable(value);
  ir.validate(captured);
  return immutable({
    id,
    kind: ir.id,
    schemaVersion: ir.version,
    contentHash: fingerprint(captured),
    revision: fingerprint({
      kind: ir.id,
      schemaVersion: ir.version,
      value: captured,
    }),
    value: captured,
  });
}
export function validateArtifact<T>(ir: IRType<T>, value: unknown): asserts value is Artifact<T> {
  if (!value || typeof value !== 'object') throw new Error(`Expected ${ir.id} artifact`);
  const a = value as Artifact<T>;
  if (a.kind !== ir.id || a.schemaVersion !== ir.version || !nonempty(a.id))
    throw new Error(`Expected ${ir.id}@${ir.version} artifact`);
  // IRWB-004: a frozen value the validator accepted is not validated again; the revision is computed once per value;
  // and an artifact `immutable` built is encodable by construction (it passed the same checks as `canonical`)
  validateOnce(ir.validate, a.value, undefined, ir);
  if (a.contentHash !== fingerprint(a.value) || a.revision !== revisionOf(a.kind, a.schemaVersion, a.value))
    throw new Error('Artifact content/revision hash does not match its immutable value');
  if (!isCanonical(a)) canonical(a);
}
export const Check: ValueType<CheckResult> = defineType<CheckResult>({
  id: 'contract.check-result',
  version: '1',
  description: 'Dynamically checked proposition and its evidence',
  validate(v: unknown): asserts v is CheckResult {
    if (!v || typeof v !== 'object' || typeof (v as CheckResult).ok !== 'boolean')
      throw new Error('Expected {ok:boolean, reason?, evidence?}');
    if ((v as CheckResult).reason !== undefined && typeof (v as CheckResult).reason !== 'string')
      throw new Error('Check reason must be text');
  },
});
export const FiniteNumber = defineType<number>({
  id: 'contract.finite-number',
  version: '1',
  description: 'Finite scalar number',
  validate(v: unknown): asserts v is number {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Expected finite number');
  },
});
export const Integer = defineType<number>({
  id: 'contract.integer',
  version: '1',
  description: 'Safe integer',
  validate(v: unknown): asserts v is number {
    if (!Number.isSafeInteger(v)) throw new Error('Expected safe integer');
  },
});
export const JsonValue = defineType<unknown>({
  id: 'contract.json',
  version: '1',
  description: 'Finite acyclic JSON value',
  validate(v: unknown): asserts v is unknown {
    canonical(v);
  },
});
