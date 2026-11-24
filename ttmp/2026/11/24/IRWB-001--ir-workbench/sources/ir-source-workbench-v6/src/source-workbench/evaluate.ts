import type ts from 'typescript';
import * as cad from '../languages/cad.js';
import * as scene from '../languages/scene.js';
import * as mechanism from '../languages/mechanism.js';
import { validateProgram, type Program } from '../languages/program.js';
import { immutable } from '../core/data.js';
import { assert } from '../core/types.js';
export type SourceFiles = Record<string, string>;
const libraries: Record<string, unknown> = {
    '../languages/cad.js': cad, '../languages/scene.js': scene, '../languages/mechanism.js': mechanism,
};
/** Transpile the user's TypeScript modules, then execute their host-language builders.
 * This is intentionally a source frontend, NOT a JS AST interpreter or security sandbox.
 * The compiler runtime receives only the validated, immutable object-language data.
 */
export function evaluateModules(compiler: typeof ts, files: SourceFiles, entry: string): Program {
    const loaded = new Map<string, {
        exports: Record<string, unknown>;
    }>(), loading = new Set<string>();
    function load(name: string): Record<string, unknown> {
        assert(/^[a-zA-Z0-9_-]+\.ts$/.test(name) && Object.hasOwn(files, name), `Unknown authored module ${name}`);
        assert(!loading.has(name), `Cyclic authored imports: ${name}`);
        const previous = loaded.get(name);
        if (previous)
            return previous.exports;
        const source = files[name];
        assert(typeof source === 'string' && source.length <= 100000, `Source exceeds 100,000 characters: ${name}`);
        const result = compiler.transpileModule(source, { fileName: name, compilerOptions: { target: compiler.ScriptTarget.ES2022, module: compiler.ModuleKind.CommonJS, strict: true, esModuleInterop: false }, reportDiagnostics: true });
        const errors = (result.diagnostics ?? []).filter(d => d.category === compiler.DiagnosticCategory.Error);
        if (errors.length)
            throw new Error(errors.map(d => {
                const p = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
                return `${name}${p ? `:${p.line + 1}:${p.character + 1}` : ''} TS${d.code}: ${compiler.flattenDiagnosticMessageText(d.messageText, '\n')}`;
            }).join('\n'));
        loading.add(name);
        const module = { exports: {} as Record<string, unknown> };
        const require = (specifier: string): unknown => {
            if (Object.hasOwn(libraries, specifier))
                return libraries[specifier];
            if (/^\.\/[a-zA-Z0-9_-]+\.js$/.test(specifier))
                return load(specifier.slice(2, -3) + '.ts');
            throw new Error(`Unsupported import ${specifier}; import a bundled language API or another authored .js module`);
        };
        try {
            new Function('require', 'exports', 'module', result.outputText + `\n//# sourceURL=authored/${name}`)(require, module.exports, module);
            loaded.set(name, module);
            return module.exports;
        }
        finally {
            loading.delete(name);
        }
    }
    const program = load(entry).default;
    validateProgram(program);
    return immutable(program);
}
