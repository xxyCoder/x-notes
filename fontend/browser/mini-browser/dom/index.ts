export const enum XNodeType {
  Text = 3,
  Element = 1
}

type XNodeMethods = 'appendChild' | 'insertBefore' | 'removeChild' | 'replaceChild' | 'cloneNode';

export class XNode {
  childNodes: XNode[];
  nodeType: XNodeType;
  nodeName: string
  nodeValue: string | null // 只有文本、注释和属性节点才有文本值
  textContent: string // 后代text节点内容的组合
  nextSibling: XNode | null;
  previousSibling: XNode | null;
  parentNode: XNode | null; // element、document和documentFragment

  constructor({ childNodes, nodeName, nodeType, nodeValue, parentNode, nextSibling, previousSibling, textContent }: Omit<XNode, XNodeMethods>) {
    this.childNodes = childNodes;
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.nodeValue = nodeValue;
    this.textContent = textContent;
    this.nextSibling = nextSibling;
    this.previousSibling = previousSibling;
    this.parentNode = parentNode;
  }

  appendChild(ch: XNode): XNode {
    ch.parentNode = this;
    const length = this.childNodes.length;
    if (length > 0) {
      const lastChild = this.childNodes[length - 1];
      lastChild.nextSibling = ch;
      ch.previousSibling = lastChild;
    }
    this.childNodes.push(ch);
    calcNodeTextContent(this)
    return ch;
  }

  insertBefore(ch: XNode, refChild: XNode | null): XNode {
    if (refChild === null) {
      return this.appendChild(ch);
    }
    ch.parentNode = this;
    const index = this.childNodes.indexOf(refChild);
    if (index === -1) {
      throw new Error('The node before which the new node is to be inserted is not a child of this node.');
    }
    this.childNodes.splice(index, 0, ch);
    if (index > 0) {
      const prevSibling = this.childNodes[index - 1];
      prevSibling.nextSibling = ch;
      ch.previousSibling = prevSibling;
    }
    ch.nextSibling = refChild;
    refChild.previousSibling = ch;
    calcNodeTextContent(this)
    return ch;
  }

  removeChild(ch: XNode): XNode {
    const index = this.childNodes.indexOf(ch);
    if (index === -1) {
      throw new Error('The node to be removed is not a child of this node.');
    }
    this.childNodes.splice(index, 1);
    if (ch.previousSibling) {
      ch.previousSibling.nextSibling = ch.nextSibling;
    }
    if (ch.nextSibling) {
      ch.nextSibling.previousSibling = ch.previousSibling;
    }
    ch.parentNode = null;
    ch.nextSibling = null;
    ch.previousSibling = null;
    calcNodeTextContent(this)
    return ch;
  }

  replaceChild(newChild: XNode, oldChild: XNode): XNode {
    const index = this.childNodes.indexOf(oldChild);
    if (index === -1) {
      throw new Error('The node to be replaced is not a child of this node.');
    }
    newChild.parentNode = this;
    this.childNodes[index] = newChild;
    if (oldChild.previousSibling) {
      oldChild.previousSibling.nextSibling = newChild;
      newChild.previousSibling = oldChild.previousSibling;
    }
    if (oldChild.nextSibling) {
      oldChild.nextSibling.previousSibling = newChild;
      newChild.nextSibling = oldChild.nextSibling;
    }
    oldChild.parentNode = null;
    oldChild.nextSibling = null;
    oldChild.previousSibling = null;
    calcNodeTextContent(this)

    return oldChild;
  }
}

function calcNodeTextContent(node: XNode) {
  if (node.nodeType === XNodeType.Text) {
    return node.nodeValue || '';
  }
  node.textContent = node.childNodes.map(c => c.textContent).join('');
  // 向上更新
  let parent = node.parentNode;
  while (parent) {
    parent.textContent = parent.childNodes.map(c => c.textContent).join('');
    parent = parent.parentNode;
  }
}

interface AttrMap {
  name: string
  value: string
}

type XElementMethods = 'setAttribute' | 'getAttribute' | 'removeAttribute' | 'hasAttribute'

export class XElement extends XNode {
  attributes: AttrMap // HTML 元素的标准属性（即在标准中定义的属性），会自动成为元素节点对象的属性
  children: XElement[]; // 只包含元素节点的子节点
  constructor({ attributes, children, ...nodeParams }: Omit<XElement, XNodeMethods | XElementMethods>) {
    super(nodeParams)
    this.children = children || [];
    this.attributes = attributes;
  }

  getAttribute(name: string): string | null {
    const attr = this.attributes[name.toLowerCase()];
    return attr ? attr.value : null;
  }
  setAttribute(name: string, value: string): void {
    const lowerName = name.toLowerCase();
    if (this.attributes[lowerName]) {
      this.attributes[lowerName].value = value;
    } else {
      this.attributes[lowerName] = { name: lowerName, value };
    }
  }
  removeAttribute(name: string): void {
    const lowerName = name.toLowerCase();
    if (this.attributes[lowerName]) {
      delete this.attributes[lowerName];
    }
  }
  hasAttribute(name: string): boolean {
    return !!this.attributes[name.toLowerCase()];
  }
}

export function xCreateElement(tagName: string, attrs: AttrMap, childNodes: XNode[]): XElement {
  return new XElement({
    childNodes,
    nodeType: XNodeType.Element,
    nodeName: tagName.toUpperCase(),
    attributes: attrs,
    nodeValue: null,
    textContent: childNodes.map(c => c.textContent).join(''),
    parentNode: null,
    nextSibling: null,
    previousSibling: null,
    children: []
  })
}

type XTextMethods = 'appendData' | 'insertData' | 'deleteData' | 'replaceData';
class XText extends XNode {
  data: string // 等同于nodeValue
  constructor({ data }: Omit<XText, keyof XNode | XTextMethods>) {
    super({
      nodeName: '#text',
      nodeType: XNodeType.Text,
      nodeValue: data,
      childNodes: [],
      textContent: data,
      parentNode: null,
      nextSibling: null,
      previousSibling: null,
    });
    this.data = data;
  }
  appendData(data: string): void {
    this.data += data;
    this.nodeValue = this.data;
    this.textContent = this.data;
    calcNodeTextContent(this);
  }
  insertData(offset: number, data: string): void {
    if (offset < 0 || offset > this.data.length) {
      throw new Error('Index size error');
    }
    this.data = this.data.slice(0, offset) + data + this.data.slice(offset);
    this.nodeValue = this.data;
    this.textContent = this.data;
    calcNodeTextContent(this);
  }
  deleteData(offset: number, count: number): void {
    if (offset < 0 || offset >= this.data.length || count < 0 || offset + count > this.data.length) {
      throw new Error('Index size error');
    }
    this.data = this.data.slice(0, offset) + this.data.slice(offset + count);
    this.nodeValue = this.data;
    this.textContent = this.data;
    calcNodeTextContent(this);
  }
  replaceData(offset: number, count: number, data: string): void {
    if (offset < 0 || offset >= this.data.length || count < 0 || offset + count > this.data.length) {
      throw new Error('Index size error');
    }
    this.data = this.data.slice(0, offset) + data + this.data.slice(offset + count);
    this.nodeValue = this.data;
    this.textContent = this.data;
    calcNodeTextContent(this);
  }
}

export function xCreateTextNode(data: string): XText {
  return new XText({ data })
}
