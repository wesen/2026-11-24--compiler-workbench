import type { DatabaseSnapshot } from '../core/records.js';
import type { SourceCatalog } from './source-catalog.js';
import { styles } from './styles.js';

/** Produces one portable HTML file: code, styles, and real trace data are embedded. */
export function renderWorkbenchHtml(snapshot:DatabaseSnapshot,bundledJS:string,sources?:SourceCatalog):string {
  const data=JSON.stringify(snapshot).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const sourceData=sources?`<script id="source-data" type="application/json">${JSON.stringify(sources).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')}</script>`:'';
  const script=bundledJS.replace(/<\/script/gi,'<\\/script');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>IR Workbench | Compiler execution explorer</title><style>${styles}</style></head><body><div id="app"><p style="padding:40px;font:16px system-ui">Loading the recorded compiler trace…</p></div><noscript>This workbench needs JavaScript to inspect its embedded trace.</noscript><script id="trace-data" type="application/json">${data}</script>${sourceData}<script>${script}</script></body></html>`;
}
