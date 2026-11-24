import {assert,positive, type IREdge} from '../core/types.js';
import {ExprBuilder,compileTape,residualProgram,type ResidualProgram,type NumericTape} from './expressions.js';
import {solveLeastSquares,type SolverResult} from './solver.js';
export interface ConstrainedSketch {
  type:'rectangle'; units:'m';
  points:Array<{id:string;x:number;y:number}>;
  program:ResidualProgram;
  solver:SolverResult;
  target:{width:number;depth:number};
}
/** Build the same generic expression/residual/tape/solver stack used by mechanisms. */
export function rectangleProgram(width:number,depth:number):ResidualProgram {
  positive(width,'width');positive(depth,'depth');
  const b=new ExprBuilder();
  const names=['x0','y0','x1','y1','x2','y2','x3','y3'];
  const [x0,y0,x1,y1,x2,y2,x3,y3]=names.map(n=>b.variable(n));
  const w=b.constant(width),d=b.constant(depth);
  const expressions=[x0!,y0!,b.sub(b.sub(x1!,x0!),w),b.sub(y1!,y0!),b.sub(x2!,x1!),b.sub(b.sub(y2!,y1!),d),b.add(b.sub(x3!,x2!),w),b.sub(y3!,y2!)];
  const constraintNames=['anchor-x','anchor-y','width','horizontal-bottom','vertical-right','depth','horizontal-width-top','horizontal-top'];
  return residualProgram(b,expressions.map((expression,i)=>({id:constraintNames[i]!,expression,scale:Math.max(width,depth)})),names);
}

export function solveRectangle(width:number,depth:number,tolerance=1e-11,program=rectangleProgram(width,depth),tape=compileTape(program)):ConstrainedSketch {
  positive(tolerance,'sketch tolerance');
  const initial={x0:width*.05,y0:-depth*.03,x1:width*.85,y1:depth*.04,x2:width*.91,y2:depth*.92,x3:width*.06,y3:depth*1.1};
  const solver=solveLeastSquares(tape,initial,{tolerance,maxIterations:80});
  assert(solver.status==='converged',`Rectangle sketch failed: ${solver.status}, residual ${solver.residualNorm}`);
  return {type:'rectangle',units:'m',points:Array.from({length:4},(_,i)=>({id:`corner:${i}`,x:solver.values[`x${i}`]!,y:solver.values[`y${i}`]!})),program,solver,target:{width,depth}};
}

/** Constraint structure follows actual expression leaves rather than an all-to-all sketch graph. */
export function sketchStructure(sketch:ConstrainedSketch):IREdge[] {
  return sketch.program.residuals.flatMap(residual=>{
    const seen=new Set<number>(),points=new Set<string>();
    const visit=(id:number):void=>{
      if(seen.has(id))return;seen.add(id);const node=sketch.program.nodes[id]!;
      if(node.op==='variable') {const match=/^[xy]([0-3])$/.exec(node.name!);if(match)points.add(`corner:${match[1]}`);}
      for(const arg of node.args)visit(arg);
    };
    visit(residual.expression);
    return [...points].sort().map(point=>({from:residual.id,to:point,relation:'constrains'}));
  });
}

