const enum XNodeType {
  Text = 3,
  Element = 1
}

interface XNode {
  childNodes?: XNode[];
  nodeType: XNodeType;
  nodeName: string
  nodeValue?: string // 只有文本、注释和属性节点才有文本值
  nextSibling?: XNode;
  previousSibling?: XNode;
  parentNode?: XNode; // element、document和documentFragment
}

interface AttrMap {
  name: string
  value: string
}

interface XElement extends XNode {
  attributes: AttrMap
}

function xCreateTextNode(txt: string): XNode {
  return {
    nodeName: '#text',
    nodeType: XNodeType.Text,
    nodeValue: txt
  }
}

function xCreateElement(tagName: string, attrs: AttrMap, childNodes: XNode[]): XElement {
  return {
    childNodes,
    nodeType: XNodeType.Element,
    nodeName: tagName,
    attributes: attrs
  }
}