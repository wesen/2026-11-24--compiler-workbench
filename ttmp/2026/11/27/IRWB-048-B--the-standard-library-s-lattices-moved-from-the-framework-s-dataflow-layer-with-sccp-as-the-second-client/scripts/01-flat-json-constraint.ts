// IRWB-048-B probe: does SCCP's constant shape satisfy the library flat lattice's `T extends Json`
// constraint without an adapter, and are the two Json declarations (the library's own and the
// framework's `core/types.ts`) mutually assignable? Run:
//   npx tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext \
//     ttmp/2026/11/27/IRWB-048-B--*/scripts/01-flat-json-constraint.ts
type FwJson = null | boolean | number | string | FwJson[] | { [key: string]: FwJson };
type LibJson = null | boolean | number | string | LibJson[] | { [key: string]: LibJson };

type Const = { readonly v: number; readonly t: 'i32' | 'f32' };
type Flat<T extends LibJson> = 'varies' | 'unknown' | { readonly value: T };

// 1. A type alias object (not an interface) gets an implicit index signature, so it meets the constraint.
type FlatConst = Flat<Const>;
// 2. The two declarations are the same type to the checker, in both directions.
const a: FwJson = null as unknown as LibJson;
const b: LibJson = null as unknown as FwJson;
// 3. The element SCCP would build is a member.
const c: FlatConst = { value: { v: 7, t: 'i32' } };
export { a, b, c };
