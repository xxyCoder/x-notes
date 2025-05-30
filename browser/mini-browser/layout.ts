import { StyleNode } from "./style-calculation";
import { XNode as XParserNode } from './dom/parser'

const innerWidth = "1920px";

class LayoutBox {
  padding: number
  margin: number
  content: Rect
  childrens: LayoutBox[]
  node: XParserNode
  constructor(content: Rect, padding: number, margin: number, styleNode: StyleNode) {
    this.node = styleNode.node
    this.margin = margin;
    this.padding = padding;
    this.content = content;
    this.childrens = [];
  }
  addChild(children: LayoutBox) {
    this.childrens.push(children);
  }
  getPosition() {
    const { x, y } = this.content;
    return { x, y };
  }
  setHeight(height: number) {
    this.content.height = height;
  }
}

class Rect {
  x: number
  y: number
  width: number
  height: number
  constructor(x: number, y: number, width: number, height: number) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
}

// 只考虑display: block元素
function layoutBlock(styleNode: StyleNode, parentLayoutBox: LayoutBox | null, prevLayoutBox: LayoutBox | null) {
  const { margin = "0px", padding = "0px", display } = styleNode.properties;
  if (display === 'none') {
    return null
  }

  const blockWidth = calcBlockWidth(styleNode);
  const { x, y } = calcBlockPosition(styleNode, parentLayoutBox, prevLayoutBox);
  const layoutBox = new LayoutBox(
    new Rect(x, y, blockWidth, 0),
    Number(padding.match(digit)![0]),
    Number(margin.match(digit)![0]),
    styleNode
  );
  for (let i = 0, j = -1; i < styleNode.childrens.length; ++i) {
    const chLayoutBox = layoutBlock(
      styleNode.childrens[i],
      layoutBox,
      j >= 0 ? layoutBox.childrens[j] : null
    );
    if (chLayoutBox) {
      layoutBox.addChild(chLayoutBox);
      ++j
    }
  }
  // 先计算子元素后才能确定高度
  const blockHeight = calcBlockHeight(styleNode, layoutBox);
  layoutBox.setHeight(blockHeight);
  return layoutBox;
}

const digit = /\d+/;
// 假设样式都标准化了
function calcBlockWidth(styleNode: StyleNode) {
  const {
    width,
    margin = "0px",
    padding = "0px",
    fontSize = "16px",
  } = styleNode.properties;
  let _widthString = width?.match(digit)?.[0];
  let _width = 0
  const _margin = margin.match(digit)?.[0] ?? 0;
  const _padding = padding.match(digit)?.[0] ?? 0;

  if (_widthString === null || typeof _widthString === "undefined") {
    const node = styleNode.node;
    _width =
      node.nodeName === "#text"
        ? node.data!.length * Number(fontSize.match(digit)![0])
        : Number(innerWidth.match(digit)![0]);
  } else {
    _width = Number(_widthString)
  }

  let blockWidth = Number(_width) - Number(_margin) - Number(_padding);
  return blockWidth;
}

function calcBlockPosition(styleNode, parentLayoutNode, prevLayoutNode) {
  const { margin = "0px" } = styleNode.properties;
  const _margin = Number(margin.match(digit)?.[0] ?? 0);
  const referenceNode = prevLayoutNode ?? parentLayoutNode;
  const { y = 0 } = referenceNode?.getPosition() ?? {};
  const { x = 0 } = parentLayoutNode?.getPosition() ?? {};
  const padding = parentLayoutNode?.padding ?? 0;
  return {
    x: padding + x + _margin,
    y: y + padding + _margin,
  };
}

function calcBlockHeight(styleNode, layoutBox) {
  const { height, fontSize = "16px" } = styleNode.properties;
  if (typeof height !== "undefined") {
    return Number(height.match(digit)[0]);
  }
  if (styleNode.node.nodeName === "#text") {
    return Number(fontSize.match(digit)[0]);
  }
  let _height = 0;
  for (let i = 0; i < layoutBox.childrens.length; ++i) {
    _height += layoutBox.childrens[i].height;
  }
  return _height;
}

export default function layout(styleSheet: StyleNode) {
  return layoutBlock(styleSheet, null, null);
}

const testStyleSheet = {
  node: {
    nodeName: "#document",
  },
  properties: {},
  childrens: [
    {
      node: {
        nodeName: "html",
        attrs: {
          lang: "en",
        },
      },
      properties: {},
      childrens: [
        {
          node: {
            nodeName: "body",
            attrs: {},
          },
          properties: {},
          childrens: [
            {
              node: {
                nodeName: "div",
                attrs: {
                  class: "main",
                },
              },
              properties: {
                margin: "20px",
                padding: "10px",
                height: "200px",
                width: "100px",
                "font-size": "18px",
              },
              childrens: [
                {
                  node: {
                    nodeName: "#text",
                    data: "hello",
                  },
                  properties: {},
                  childrens: [],
                },
              ],
            },
            {
              node: {
                nodeName: "p",
                attrs: {
                  id: "box",
                },
              },
              properties: {
                "background-color": "rgb(100,100,100)",
              },
              childrens: [],
            },
            {
              node: {
                nodeName: "img",
                attrs: {
                  src: "./img/1.png",
                  alt: "test",
                },
              },
              properties: {
                height: "100px",
                width: "100px",
              },
              childrens: [],
            },
          ],
        },
      ],
    },
  ],
};

