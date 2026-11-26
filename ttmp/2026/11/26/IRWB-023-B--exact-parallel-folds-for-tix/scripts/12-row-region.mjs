// A four-definition region can have any rank-two input produced earlier in this function.
// Fail closed on index maps, extents, grouping, or live intermediate definitions.
import {visit} from '../../../../../../dist/tensor/model.js';
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const dim=(a,extent)=>a?.extent.kind==='dim' && eq(a.extent.dim,extent);
const plain=(a,id)=>a?.constant===0 && a.terms.length===1 && eq(a.terms[0],[id,1]);
const load=(e,name,ids)=>e?.kind==='load'&&e.name===name&&e.indices.length===ids.length&&e.indices.every((a,i)=>plain(a,ids[i]));
const op=(e,name)=>e?.kind==='op'&&e.op===name;

export function inspectRow(fn,first) {
  const [m,e,s,y]=fn.statements.slice(first,first+4);
  if(!y) return {error:'region too short'};
  const input=m.expr.body?.name;
  const x=[...fn.params,...fn.statements.slice(0,first)].find(t=>t.name===input);
  if(x?.shape.length!==2) return {error:'missing rank-two producer'};
  const [N,C]=x.shape;
  for(const [stmt,shape] of [[m,[N]],[e,[N,C]],[s,[N]],[y,[N,C]]])
    if(!eq(stmt.shape,shape)||stmt.axes.length!==shape.length||!stmt.axes.every((a,i)=>dim(a,shape[i]))) return {error:'iteration domain'};
  function rowFold(stmt,name,tensor) {
    const r=stmt.expr;
    return r.kind==='reduce'&&r.op===name&&r.axes.length===1&&dim(r.axes[0],C)&&load(r.body,tensor,[stmt.axes[0].id,r.axes[0].id]);
  }
  if(!rowFold(m,'max',x.name)) return {error:'maximum must cover this parameter row'};
  const ea=e.axes.map(a=>a.id),ya=y.axes.map(a=>a.id),sub=e.expr.args?.[0];
  if(!op(e.expr,'exp')||!op(sub,'-')||!load(sub.args[0],x.name,ea)||!load(sub.args[1],m.name,[ea[0]])) return {error:'shift lacks its same-row maximum'};
  if(!rowFold(s,'sum',e.name)) return {error:'sum has different fold tree or index map'};
  if(!op(y.expr,'/')||!load(y.expr.args[0],e.name,ya)||!load(y.expr.args[1],s.name,[ya[0]])) return {error:'divide or broadcast differs'};
  const privateTensors=new Set([m.name,e.name,s.name]);
  let escape=privateTensors.has(fn.result);
  for(const later of fn.statements.slice(first+4))
    visit(later.expr,node=>{ if(node.kind==='load' && privateTensors.has(node.name)) escape=true; });
  if(escape) return {error:'internal tensor escapes the four-statement region'};
  return {first,input:x.name,output:y.name,shape:y.shape};
}
export function regions(fn) {
  return fn.statements.map((_,i)=>inspectRow(fn,i)).filter(s=>!s.error);
}
