/** Presentation-only serialization of the compiler's JSON-compatible data model.
 * Keep scalar sequences compact, preserve mapping order and quote ambiguous strings.
 * Undefined values in optional inspector fields are rendered as null (not IR data). */
function quote(s:string):string {return JSON.stringify(s).replace(/[\u0085\u2028\u2029\u007f-\u009f\ud800-\udfff]/gu,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);}
function safeString(s:string):boolean {
  return /^[A-Za-z_][A-Za-z0-9_./@+-]*(?: [A-Za-z0-9_./@+-]+)*$/.test(s)&&
    !/^(?:null|true|false|yes|no|on|off|y|n)$/i.test(s);
}
function scalar(v:unknown):string|undefined {
  if(v===null||v===undefined)return 'null';
  if(typeof v==='boolean')return String(v);
  if(typeof v==='number')return Number.isFinite(v)?(Object.is(v,-0)?'-0.0':String(v).replace(/^(\-?\d+)(e[+-]?\d+)$/i,'$1.0$2')):quote(String(v));
  if(typeof v==='string')return safeString(v)?v:quote(v);
  if(Array.isArray(v)&&v.length===0)return '[]';
  if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===0)return '{}';
  if(Array.isArray(v)){
    const items=v.map(x=>x!==null&&typeof x==='object'?undefined:scalar(x));
    if(items.every(x=>x!==undefined)){
      // Flow style strings use quotes even if block-style plain strings are safe.
      const out=`[${v.map((x,i)=>typeof x==='string'?quote(x):items[i]).join(', ')}]`;
      if(out.length<=110)return out;
    }
  }
  return undefined;
}
export function yaml(value:unknown):string {
  const lines:string[]=[];
  function emit(v:unknown,depth:number,prefix=''):void {
    const pad=' '.repeat(depth),s=scalar(v);
    if(s!==undefined){lines.push(`${pad}${prefix}${s}`);return;}
    if(prefix){lines.push(pad+prefix.trimEnd());depth+=2;}
    const p=' '.repeat(depth);
    if(Array.isArray(v))for(const x of v)emit(x,depth,'- ');
    else if(v&&typeof v==='object')for(const [key,x] of Object.entries(v))emit(x,depth,`${safeString(key)?key:quote(key)}: `);
    else lines.push(p+'null');
  }
  emit(value,0);return lines.join('\n');
}

export interface Token {text:string;kind:string}
const keywords=new Set('abstract any as asserts async await bigint boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of override private protected public readonly require return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield'.split(' '));
/** Lightweight, lossless lexical coloring; not a replacement for the TypeScript parser. */
export function tokenizeTS(source:string):Token[]{
  const re=/\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\\r\n])*(?:"|$)|'(?:\\[\s\S]|[^'\\\r\n])*(?:'|$)|`(?:\\[\s\S]|[^`\\])*(?:`|$)|\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?)n?\b|[A-Za-z_$][\w$]*|=>|[{}()[\];:,.!?=+*/%<>|&^~\-]/g;
  const out:Token[]=[];let at=0;
  for(const m of source.matchAll(re)){
    const i=m.index!,text=m[0];if(i>at)out.push({text:source.slice(at,i),kind:''});
    let kind='punct';if(text.startsWith('//')||text.startsWith('/*'))kind='comment';else if(/^['"`]/.test(text))kind='string';else if(/^\d/.test(text))kind='number';else if(/^[A-Za-z_$]/.test(text))kind=keywords.has(text)?'keyword':/^\s*\(/.test(source.slice(i+text.length))?'function':/^[A-Z]/.test(text)?'type':'';
    out.push({text,kind});at=i+text.length;
  }if(at<source.length)out.push({text:source.slice(at),kind:''});return out;
}
export function tokenizeYAML(source:string):Token[]{
  const out:Token[]=[];
  // The serializer only emits simple plain scalars, double-quoted strings, and flow sequences.
  const re=/"(?:\\.|[^"\\])*"|(?:^|(?<=\s))[A-Za-z_][A-Za-z0-9_./@+ -]*(?=: )|(?:^|(?<=[\s,[\-]))(?:true|false|null)(?=$|[\s,\]])|(?:^|(?<=[\s,[\-]))-?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=$|[\s,\]])|[\[\]{},:]|(?:^|(?<=\n))\s*- (?=\S)/gm;
  let at=0;for(const m of source.matchAll(re)){const i=m.index!,text=m[0];if(i>at)out.push({text:source.slice(at,i),kind:''});const next=source.slice(i+text.length,i+text.length+2);const kind=next.startsWith(':')?'key':text.startsWith('"')?'string':/^(true|false|null)$/.test(text)?'keyword':/^-?\d/.test(text)?'number':'punct';out.push({text,kind});at=i+text.length;}if(at<source.length)out.push({text:source.slice(at),kind:''});return out;
}
export function tokenLines(tokens:Token[]):Token[][] {
  const result:Token[][]=[[]];for(const {text,kind} of tokens){const parts=text.split('\n');parts.forEach((part,i)=>{if(i)result.push([]);if(part)result.at(-1)!.push({text:part,kind});});}return result;
}
/** Use text nodes rather than HTML, including when highlighting arbitrary user source. */
export function renderTokens(host:Node,tokens:Token[],needle=''):void {
  const fragment=document.createDocumentFragment(),raw=tokens.map(t=>t.text).join(''),low=raw.toLowerCase(),matches:Array<[number,number]>=[];let match=needle?low.indexOf(needle):-1;
  while(match>=0){matches.push([match,match+needle.length]);match=low.indexOf(needle,match+needle.length);}
  let offset=0,j=0;
  const append=(text:string,kind:string,marked:boolean)=>{if(!text)return;let node:Node=document.createTextNode(text);if(kind){const span=document.createElement('span');span.className=`tok-${kind}`;span.append(node);node=span;}if(marked){const mark=document.createElement('mark');mark.append(node);node=mark;}fragment.append(node);};
  for(const t of tokens){const end=offset+t.text.length;let i=offset;while(i<end){while(j<matches.length&&matches[j][1]<=i)j++;const m=matches[j];if(!m||m[0]>=end){append(raw.slice(i,end),t.kind,false);break;}if(i<m[0]){append(raw.slice(i,m[0]),t.kind,false);i=m[0];}else{const e=Math.min(end,m[1]);append(raw.slice(i,e),t.kind,true);i=e;}}offset=end;}host.appendChild(fragment);
}
