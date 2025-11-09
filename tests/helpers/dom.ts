const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;
const DOCUMENT_NODE = 9;

class SimpleEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  target: SimpleNode | null = null;
  currentTarget: SimpleNode | null = null;
  defaultPrevented = false;
  private _stop = false;
  private _stopImmediate = false;

  constructor(type: string, options: { bubbles?: boolean; cancelable?: boolean } = {}) {
    this.type = type;
    this.bubbles = options.bubbles ?? false;
    this.cancelable = options.cancelable ?? false;
  }

  preventDefault() {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation() {
    this._stop = true;
  }

  stopImmediatePropagation() {
    this._stopImmediate = true;
    this._stop = true;
  }

  get cancelled() {
    return this.defaultPrevented;
  }

  get propagationStopped() {
    return this._stop;
  }

  get immediatePropagationStopped() {
    return this._stopImmediate;
  }
}

class SimpleEventTarget {
  private listeners: Map<string, Set<EventListener>> = new Map();

  addEventListener(type: string, listener: EventListener | null) {
    if (!listener) return;
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener | null) {
    if (!listener) return;
    this.listeners.get(type)?.delete(listener);
  }

  protected dispatch(event: SimpleEvent, target: SimpleNode) {
    const list = this.listeners.get(event.type);
    if (!list || list.size === 0) {
      return;
    }
    for (const listener of Array.from(list)) {
      if (event.immediatePropagationStopped) {
        break;
      }
      listener.call(target, event);
    }
  }
}

type EventListener = (event: SimpleEvent) => void;

class SimpleNode extends SimpleEventTarget {
  nodeType: number;
  parentNode: SimpleNode | null = null;
  childNodes: SimpleNode[] = [];
  ownerDocument: SimpleDocument;

  constructor(nodeType: number, ownerDocument: SimpleDocument) {
    super();
    this.nodeType = nodeType;
    this.ownerDocument = ownerDocument;
  }

  appendChild<T extends SimpleNode>(node: T): T {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  insertBefore<T extends SimpleNode>(node: T, reference: SimpleNode | null): T {
    node.parentNode = this;
    if (!reference) {
      this.childNodes.push(node);
      return node;
    }
    const index = this.childNodes.indexOf(reference);
    if (index === -1) {
      this.childNodes.push(node);
    } else {
      this.childNodes.splice(index, 0, node);
    }
    return node;
  }

  removeChild<T extends SimpleNode>(node: T): T {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) {
      this.childNodes.splice(index, 1);
      node.parentNode = null;
    }
    return node;
  }

  get firstChild(): SimpleNode | null {
    return this.childNodes[0] ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  set textContent(value: string) {
    this.childNodes = [];
    if (value) {
      this.appendChild(this.ownerDocument.createTextNode(value));
    }
  }

  dispatchEvent(event: SimpleEvent): boolean {
    if (!(event instanceof SimpleEvent)) {
      throw new Error("Only SimpleEvent instances can be dispatched");
    }
    if (!event.target) {
      event.target = this;
    }
    let current: SimpleNode | null = this;
    while (current) {
      if (event.immediatePropagationStopped) {
        break;
      }
      event.currentTarget = current;
      current.dispatch(event, event.target);
      if (!event.bubbles || event.propagationStopped) {
        break;
      }
      current = current.parentNode;
    }
    return !event.cancelled;
  }
}

class SimpleText extends SimpleNode {
  data: string;
  constructor(data: string, owner: SimpleDocument) {
    super(TEXT_NODE, owner);
    this.data = data;
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string) {
    this.data = value;
  }
}

class SimpleComment extends SimpleNode {
  data: string;
  constructor(data: string, owner: SimpleDocument) {
    super(COMMENT_NODE, owner);
    this.data = data;
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string) {
    this.data = value;
  }
}

class SimpleElement extends SimpleNode {
  tagName: string;
  localName: string;
  namespaceURI: string;
  attributes: Map<string, string> = new Map();
  style: Record<string, string> = {};
  private classListSet: Set<string> = new Set();

  constructor(tagName: string, owner: SimpleDocument, namespaceURI = "http://www.w3.org/1999/xhtml") {
    super(ELEMENT_NODE, owner);
    this.tagName = tagName.toUpperCase();
    this.localName = tagName.toLowerCase();
    this.namespaceURI = namespaceURI;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
    if (name === "class" || name === "className") {
      this.className = value;
    }
    if (name === "id") {
      // no-op: stored in attributes
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === "class" || name === "className") {
      this.classListSet.clear();
    }
  }

  get className(): string {
    return Array.from(this.classListSet).join(" ");
  }

  set className(value: string) {
    this.classListSet = new Set(value ? value.split(/\s+/).filter(Boolean) : []);
    this.attributes.set("class", this.className);
  }

  get classList() {
    const element = this;
    return {
      add(...tokens: string[]) {
        tokens.forEach((token) => element.classListSet.add(token));
        element.attributes.set("class", element.className);
      },
      remove(...tokens: string[]) {
        tokens.forEach((token) => element.classListSet.delete(token));
        element.attributes.set("class", element.className);
      },
      contains(token: string) {
        return element.classListSet.has(token);
      },
    };
  }

  get children(): SimpleElement[] {
    return this.childNodes.filter((node) => node.nodeType === ELEMENT_NODE) as SimpleElement[];
  }

  querySelector(selector: string): SimpleElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): SimpleElement[] {
    const matchers = selector.split(",").map((part) => createMatcher(part.trim()));
    const results: SimpleElement[] = [];
    const visit = (node: SimpleNode) => {
      if (node.nodeType === ELEMENT_NODE) {
        const element = node as SimpleElement;
        if (matchers.some((matches) => matches(element))) {
          results.push(element);
        }
      }
      node.childNodes.forEach(visit);
    };
    this.childNodes.forEach(visit);
    return results;
  }

  closest(selector: string): SimpleElement | null {
    let current: SimpleNode | null = this;
    const matcher = createMatcher(selector.trim());
    while (current) {
      if (current instanceof SimpleElement && matcher(current)) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  focus() {}
  blur() {}

  getBoundingClientRect() {
    return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 };
  }
}

function createMatcher(selector: string) {
  if (!selector) {
    return () => false;
  }
  const attributeMatch = selector.match(/^(\w+)(\[([^=]+)=\"?([^\]"]+)\"?\])?$/);
  if (attributeMatch) {
    const tag = attributeMatch[1]?.toLowerCase();
    const attrName = attributeMatch[3];
    const attrValue = attributeMatch[4];
    return (element: SimpleElement) => {
      if (tag && element.localName !== tag) return false;
      if (!attrName) return true;
      return element.getAttribute(attrName) === attrValue;
    };
  }
  if (selector.startsWith("#")) {
    const id = selector.slice(1);
    return (element: SimpleElement) => element.getAttribute("id") === id;
  }
  if (selector.startsWith(".")) {
    const cls = selector.slice(1);
    return (element: SimpleElement) => element.classList.contains(cls);
  }
  return (element: SimpleElement) => element.localName === selector.toLowerCase();
}

class SimpleDocument extends SimpleNode {
  defaultView!: SimpleWindow;
  documentElement: SimpleElement;
  head: SimpleElement;
  body: SimpleElement;
  readyState = "complete";
  private cookieStore = "";

  constructor() {
    super(DOCUMENT_NODE, undefined as unknown as SimpleDocument);
    this.ownerDocument = this;
    this.documentElement = new SimpleElement("html", this);
    this.head = new SimpleElement("head", this);
    this.body = new SimpleElement("body", this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tagName: string): SimpleElement {
    if (tagName.toLowerCase() === "canvas") {
      return new SimpleCanvasElement(this);
    }
    if (tagName.toLowerCase() === "video") {
      return new SimpleVideoElement(this);
    }
    return new SimpleElement(tagName, this);
  }

  createElementNS(namespace: string, tagName: string): SimpleElement {
    return new SimpleElement(tagName, this, namespace);
  }

  createTextNode(data: string): SimpleText {
    return new SimpleText(data, this);
  }

  createComment(data: string): SimpleComment {
    return new SimpleComment(data, this);
  }

  get cookie(): string {
    return this.cookieStore;
  }

  set cookie(value: string) {
    const next = String(value);
    if (!next) return;
    if (!this.cookieStore) {
      this.cookieStore = next;
    } else {
      this.cookieStore = `${this.cookieStore}; ${next}`;
    }
  }

  getElementById(id: string): SimpleElement | null {
    const visit = (node: SimpleNode): SimpleElement | null => {
      if (node instanceof SimpleElement) {
        if (node.getAttribute("id") === id) return node;
      }
      for (const child of node.childNodes) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this.documentElement);
  }

  querySelector(selector: string): SimpleElement | null {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): SimpleElement[] {
    return this.documentElement.querySelectorAll(selector);
  }

  createRange() {
    return {
      setStart() {},
      setEnd() {},
      commonAncestorContainer: this.body,
    };
  }
}

class SimpleCanvasElement extends SimpleElement {
  constructor(owner: SimpleDocument) {
    super("canvas", owner);
  }

  getContext() {
    return {
      drawImage() {},
      fillRect() {},
    };
  }

  toDataURL() {
    return "data:image/png;base64,TEST";
  }

  toBlob(callback: (blob: Blob | null) => void) {
    const blob = new Blob(["stub"], { type: "image/png" });
    callback(blob);
  }
}

class SimpleVideoElement extends SimpleElement {
  srcObject: unknown = null;
  muted = false;
  playsInline = false;

  constructor(owner: SimpleDocument) {
    super("video", owner);
  }

  async play() {}
}

class LocalStorageMock {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

class SimpleWindow extends SimpleEventTarget {
  document: SimpleDocument;
  location = { href: "http://localhost/" };
  navigator = {
    userAgent: "node",
    mediaDevices: {
      async getUserMedia() {
        throw new Error("getUserMedia not available in tests");
      },
    },
  };
  localStorage = new LocalStorageMock();
  sessionStorage = new LocalStorageMock();
  matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  innerWidth = 1024;
  innerHeight = 768;

  constructor(document: SimpleDocument) {
    super();
    this.document = document;
  }

  getComputedStyle() {
    return {
      getPropertyValue() {
        return "";
      },
    };
  }

  requestAnimationFrame(callback: (time: number) => void) {
    return setTimeout(() => callback(Date.now()), 16);
  }

  cancelAnimationFrame(handle: any) {
    clearTimeout(handle);
  }

  setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]) {
    return setInterval(handler, timeout, ...args);
  }

  clearInterval(handle: any) {
    clearInterval(handle);
  }

  setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]) {
    return setTimeout(handler, timeout, ...args);
  }

  clearTimeout(handle: any) {
    clearTimeout(handle);
  }

  scrollTo() {}
}

export function setupDom() {
  const document = new SimpleDocument();
  const window = new SimpleWindow(document);
  document.defaultView = window;

  (globalThis as any).window = window;
  (globalThis as any).document = document;
  (globalThis as any).navigator = window.navigator;
  (globalThis as any).localStorage = window.localStorage;
  (globalThis as any).sessionStorage = window.sessionStorage;
  (globalThis as any).HTMLElement = SimpleElement;
  (globalThis as any).HTMLInputElement = SimpleElement;
  (globalThis as any).HTMLTextAreaElement = SimpleElement;
  (globalThis as any).HTMLFormElement = SimpleElement;
  (globalThis as any).Event = SimpleEvent;
  (globalThis as any).MouseEvent = SimpleEvent;
  (globalThis as any).KeyboardEvent = SimpleEvent;
  (globalThis as any).FocusEvent = SimpleEvent;
  (globalThis as any).CustomEvent = SimpleEvent;
  (globalThis as any).EventTarget = SimpleEventTarget;
  (globalThis as any).requestAnimationFrame = window.requestAnimationFrame.bind(window);
  (globalThis as any).cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  return {
    window,
    document,
    cleanup() {
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      delete (globalThis as any).navigator;
      delete (globalThis as any).localStorage;
      delete (globalThis as any).sessionStorage;
      delete (globalThis as any).HTMLElement;
      delete (globalThis as any).HTMLInputElement;
      delete (globalThis as any).HTMLTextAreaElement;
      delete (globalThis as any).HTMLFormElement;
      delete (globalThis as any).Event;
      delete (globalThis as any).MouseEvent;
      delete (globalThis as any).KeyboardEvent;
      delete (globalThis as any).FocusEvent;
      delete (globalThis as any).CustomEvent;
      delete (globalThis as any).EventTarget;
      delete (globalThis as any).requestAnimationFrame;
      delete (globalThis as any).cancelAnimationFrame;
      delete (globalThis as any).ResizeObserver;
    },
  };
}

export function findByText(root: SimpleElement, text: string): SimpleElement | null {
  const normalized = text.trim();
  const visit = (node: SimpleNode): SimpleElement | null => {
    if (node instanceof SimpleElement) {
      if (node.textContent.trim() === normalized) {
        return node;
      }
    }
    for (const child of node.childNodes) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(root);
}

export function findByRole(root: SimpleElement, role: string, options: { name?: string } = {}) {
  const { name } = options;
  const visit = (node: SimpleNode): SimpleElement | null => {
    if (node instanceof SimpleElement) {
      const elementRole = node.getAttribute("role") ?? inferImplicitRole(node);
      if (elementRole === role) {
        if (!name) return node;
        if (node.textContent.trim() === name.trim()) {
          return node;
        }
      }
    }
    for (const child of node.childNodes) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(root);
}

function inferImplicitRole(element: SimpleElement): string | null {
  switch (element.localName) {
    case "button":
      return "button";
    case "form":
      return "form";
    case "input":
      return element.getAttribute("type") === "submit" ? "button" : "textbox";
    case "table":
      return "table";
    case "thead":
      return "rowgroup";
    case "tbody":
      return "rowgroup";
    case "tr":
      return "row";
    case "th":
      return "columnheader";
    case "td":
      return "cell";
    default:
      return null;
  }
}

export function fireEvent(target: SimpleElement, type: string, options: { bubbles?: boolean; cancelable?: boolean } = {}) {
  const event = new SimpleEvent(type, { bubbles: options.bubbles ?? true, cancelable: options.cancelable ?? true });
  target.dispatchEvent(event);
  return event;
}

export function setInputValue(input: SimpleElement, value: string) {
  (input as any).value = value;
  fireEvent(input, "input");
  fireEvent(input, "change");
}

export function clickElement(element: SimpleElement) {
  fireEvent(element, "click");
}
export function findByTextContains(root: SimpleElement, text: string): SimpleElement | null {
  const normalized = text.trim();
  const visit = (node: SimpleNode): SimpleElement | null => {
    if (node instanceof SimpleElement) {
      if (node.textContent.includes(normalized)) {
        return node;
      }
    }
    for (const child of node.childNodes) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(root);
}
export type { SimpleElement };
