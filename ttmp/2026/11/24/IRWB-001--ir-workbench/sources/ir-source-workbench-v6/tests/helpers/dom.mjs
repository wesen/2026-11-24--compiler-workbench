/** Minimal DOM test double for component logic. It does not render layout, run a
 * browser, implement workers, or prove visual/accessibility behavior. */
export function installDOM() {
  const pending = [];
  class Node {
    constructor(tag = '', type = 1, text = '') {
      this.tagName = tag.toUpperCase(); this.nodeType = type; this.data = text;
      this.childNodes = []; this.parentNode = null; this.attributes = new Map(); this.listeners = new Map();
      this.className = ''; this.dataset = {}; this.value = ''; this.disabled = false; this.hidden = false;
      this.scrollTop = 0; this.scrollLeft = 0; this.clientHeight = 330; this.clientWidth = 700;
      this.style = { setProperty(name, value) { this[name] = value; } };
      const owner = this;
      this.classList = {
        contains(c) { return owner.className.split(/\s+/).includes(c); },
        add(...cs) { owner.className = [...new Set([...owner.className.split(/\s+/).filter(Boolean), ...cs])].join(' '); },
        remove(...cs) { owner.className = owner.className.split(/\s+/).filter(c => c && !cs.includes(c)).join(' '); },
        toggle(c, force) { const next = force ?? !this.contains(c); if (next) this.add(c); else this.remove(c); return next; }
      };
    }
    get children() { return this.childNodes.filter(n => n.nodeType === 1); }
    get firstElementChild() { return this.children[0] ?? null; }
    get lastElementChild() { return this.children.at(-1) ?? null; }
    get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map(n => n.textContent).join(''); }
    set textContent(value) { this.replaceChildren(String(value ?? '')); }
    get innerText() { return this.textContent; }
    appendChild(value) {
      const node = typeof value === 'string' ? new Node('', 3, value) : value;
      if (node.nodeType === 11) { for (const child of [...node.childNodes]) this.appendChild(child); return node; }
      if (node.parentNode) node.parentNode.childNodes = node.parentNode.childNodes.filter(n => n !== node);
      node.parentNode = this; this.childNodes.push(node); return node;
    }
    append(...values) { for (const value of values) this.appendChild(value); }
    replaceChildren(...values) { for (const child of this.childNodes) child.parentNode = null; this.childNodes = []; this.append(...values); }
    remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter(n => n !== this); this.parentNode = null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'class') this.className = String(value); if (name === 'id') this.id = String(value); }
    getAttribute(name) { return name === 'class' ? this.className : this.attributes.get(name) ?? null; }
    hasAttribute(name) { return name === 'class' ? !!this.className : this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, handler) { const handlers = this.listeners.get(type) ?? []; handlers.push(handler); this.listeners.set(type, handlers); }
    removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(h => h !== handler)); }
    dispatchEvent(event) {
      for (const handler of this.listeners.get(event.type) ?? []) { const result = handler(event); if (result?.then) pending.push(result); }
      return true;
    }
    click() { if (!this.disabled) this.dispatchEvent({ type: 'click', preventDefault() {} }); }
    getBoundingClientRect() { return { top: 0, left: 0, width: this.clientWidth, height: this.clientHeight, x: 0, y: 0, right: this.clientWidth, bottom: this.clientHeight }; }
    getContext() { return new Proxy({}, { get(target, key) { if (key in target) return target[key]; if (key === 'createLinearGradient') return () => ({ addColorStop() {} }); return () => {}; } }); }
    setPointerCapture() {}
    setRangeText(replacement, start, end) { this.value = this.value.slice(0, start) + replacement + this.value.slice(end); this.selectionStart = this.selectionEnd = start + replacement.length; }
    matches(selector) {
      const attrs = [...selector.matchAll(/\[([^\]=]+)(?:=["']([^"']*)["'])?\]/g)];
      for (const [, name, value] of attrs) {
        const got = name.startsWith('data-') ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : this.getAttribute(name);
        if (got == null || (value !== undefined && got !== value)) return false;
      }
      const base = selector.replace(/\[[^\]]+\]/g, ''), tag = base.match(/^[a-zA-Z][\w-]*/)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const id = base.match(/#([\w-]+)/)?.[1]; if (id && this.id !== id) return false;
      for (const [, c] of base.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(c)) return false;
      return this.nodeType === 1;
    }
    querySelectorAll(selector) {
      const selectors = selector.split(',').map(s => s.trim()); const found = [];
      const visit = node => { for (const child of node.children) { if (selectors.some(s => child.matches(s))) found.push(child); visit(child); } };
      visit(this); return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  }
  const body = new Node('body');
  const document = { body, createElement: tag => new Node(tag), createElementNS: (_ns, tag) => new Node(tag), createTextNode: text => new Node('', 3, String(text)), createDocumentFragment: () => new Node('', 11), getElementById: id => body.querySelector(`#${id}`) };
  const names = ['document', 'Node', 'HTMLElement', 'ResizeObserver'], before = new Map(names.map(name => [name, globalThis[name]]));
  Object.assign(globalThis, { document, Node, HTMLElement: Node, ResizeObserver: class { observe() {} disconnect() {} } });
  return {
    document, Node,
    async settled() { while (pending.length) await Promise.all(pending.splice(0)); },
    restore() { for (const [key, value] of before) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; },
    button(root, label) { const matches = root.querySelectorAll('button').filter(b => b.textContent === label); if (matches.length !== 1) throw new Error(`Expected one button ${label}; found ${matches.length}`); return matches[0]; },
    change(input, value) { input.value = value; input.dispatchEvent({ type: 'change', preventDefault() {} }); },
    input(input, value) { input.value = value; input.dispatchEvent({ type: 'input', preventDefault() {} }); }
  };
}
