import {Compiler,type CompilationRun,type RunOptions} from '../core/runtime.js';
import type {Artifact} from '../core/types.js';
import {registerMath} from '../math/register.js';
import {registerGeometry,type MeshMetrics} from '../geometry/mesh.js';
import {registerScene,type ScenePackage} from '../scene/schema.js';
import {registerAssembly} from '../assembly/planar.js';
import {registerAssemblyPhysicsAdapter} from '../adapters/assembly-physics.js';
import {registerCAD,defaultCADInputs,cadTasks} from '../domains/cad.js';
import {registerPhysics,defaultPhysicsInputs,physicsTasks,type MotionIR} from '../domains/physics.js';
import {registerGame,defaultGameInputs,gameTasks} from '../domains/game.js';
import {registerDoor,defaultDoorInputs,doorTasks,type AnimatedScenePackage} from '../domains/door.js';

export function defaultInputs():Record<string,unknown> {return {...defaultCADInputs(),...defaultGameInputs(),...defaultPhysicsInputs(),...defaultDoorInputs()};}
export function createProject(inputs:Record<string,unknown>={}):Compiler {
  const compiler=new Compiler({maxCacheEntries:4096});
  registerMath(compiler);registerGeometry(compiler);registerScene(compiler);registerAssembly(compiler);
  registerCAD(compiler);registerPhysics(compiler);registerGame(compiler);registerAssemblyPhysicsAdapter(compiler);registerDoor(compiler);
  compiler.setInputs({...defaultInputs(),...inputs});return compiler;
}
export function projectTasks() {const cad=cadTasks();return {cad,game:gameTasks(),physics:physicsTasks(),door:doorTasks(cad)};}
export interface ProjectArtifacts {cad:Artifact<MeshMetrics>;game:Artifact<ScenePackage>;physics:Artifact<MotionIR>;door:Artifact<AnimatedScenePackage>}
export async function compileProject(compiler:Compiler,label:string,options:RunOptions={}):Promise<{artifacts:ProjectArtifacts;run:CompilationRun}> {
  const tasks=projectTasks();
  const result=await compiler.run(label,async run=>{
    const [cad,game,physics,door]=await Promise.all([
      run.require<MeshMetrics>(tasks.cad.metrics),run.require<ScenePackage>(tasks.game.package),
      run.require<MotionIR>(tasks.physics.selected),run.require<AnimatedScenePackage>(tasks.door.package)
    ]);
    return {cad,game,physics,door};
  },options);
  return {artifacts:result.value,run:result.run};
}
