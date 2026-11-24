import { append, element } from '../workbench/dom.js';
import { renderTokens, tokenizeYAML } from '../workbench/presentation.js';

/** Editable data with the same YAML token renderer as every read-only IR view. */
export function mountYAMLEditor(host: HTMLElement, label: string, initial: string, onChange: (text: string) => void): { textarea: HTMLTextAreaElement; set(text: string): void; destroy(): void } {
  const wrapper = element('div', 'ir-data-editor'), color = element('pre', 'ir-data-color'), input = element('textarea', 'ir-data-input');
  color.setAttribute('aria-hidden', 'true'); input.setAttribute('aria-label', label); input.value = initial; input.spellcheck = false; input.wrap = 'off'; input.autocomplete = 'off'; input.autocapitalize = 'off';
  function sync(): void { color.scrollTop = input.scrollTop; color.scrollLeft = input.scrollLeft; }
  function highlight(): void { color.replaceChildren(); renderTokens(color, tokenizeYAML(input.value)); color.append(document.createTextNode('\n')); sync(); }
  input.addEventListener('input', () => { highlight(); onChange(input.value); }); input.addEventListener('scroll', sync);
  input.addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end'); highlight(); onChange(input.value); } });
  const observer = new ResizeObserver(() => { color.style.height = `${input.clientHeight}px`; color.style.width = `${input.clientWidth}px`; sync(); }); observer.observe(input);
  append(wrapper, color, input); host.append(wrapper); highlight();
  return { textarea: input, set(text) { input.value = text; highlight(); }, destroy() { observer.disconnect(); wrapper.remove(); } };
}
