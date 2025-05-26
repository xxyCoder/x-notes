const enum XNodeType {
  Text,
  Element
}

interface XNode {
  children: XNode[];
  nodeType: XNodeType;
  nodeValue?: string | XElement
}

type AttrMap = Record<string, string>;

interface XElement {
  tagName: string;
  attrs: AttrMap
}

function xCreateTextNode(txt: string): XNode {
  return {
    children: [],
    nodeType: XNodeType.Text,
    nodeValue: txt
  }
}

function xCreateElement(tagName: string, attrs: AttrMap, children:  XNode[]): XNode {
  return {
    children,
    nodeType: XNodeType.Element,
    nodeValue: {
      tagName,
      attrs
    }
  }
}