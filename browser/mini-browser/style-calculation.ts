import { XNode as XParserNode } from './dom/parser'
import { XCSSAST, XCSSRule as XParserRule } from './css/parser'

export class StyleNode {
  node: XParserNode
  properties: Record<string, string>
  childrens: StyleNode[]
  constructor(node: XParserNode, properties: Record<string, string>) {
    this.node = node;
    this.properties = properties;
    this.childrens = [];
  }
  addChild(styleNode: StyleNode) {
    this.childrens.push(styleNode);
  }
}

function selectorMatchAndCalcRuleWeight(elem: XParserNode, selectorText: string) {
  const selectors = selectorText.split(",") ?? [];
  const idSelectors = elem?.attrs?.id?.split(" ") ?? [];
  const classSelectors = elem?.attrs?.class?.split(" ") ?? [];
  let ruleWeight = 0;
  if (selectors.includes(elem.nodeName)) {
    ruleWeight = 1;
  }
  // 简单考虑出现的选择器类型
  const isMatchClassSelector = selectors.some(
    (selector) =>
      selector.startsWith(".") && classSelectors.includes(selector.slice(1))
  );

  if (isMatchClassSelector) {
    ruleWeight = 10;
  }

  const isMatchIdSelector = selectors.some(
    (selector) =>
      selector.startsWith("#") && idSelectors.includes(selector.slice(1))
  );

  if (isMatchIdSelector) {
    ruleWeight = 100;
  }

  return ruleWeight;
}

interface MatchRule {
  ruleWeight: number
  rule: XParserRule
}

function matchCSSRules(elem: XParserNode, rules: XParserRule[]) {
  const matchRules: MatchRule[] = [];
  for (let i = 0; i < rules.length; ++i) {
    const rule = rules[i];
    const ruleWeight = selectorMatchAndCalcRuleWeight(elem, rule.selectorText);
    if (ruleWeight > 0) {
      matchRules.push({
        ruleWeight,
        rule,
      });
    }
  }
  return matchRules;
}

function handleRules(rules: MatchRule[]) {
  rules.sort((r1, r2) => r1.ruleWeight - r2.ruleWeight);
  const styles = {};
  rules.forEach(({ rule }) => {
    rule.style.forEach(({ cssText, ...others }) => {
      Object.assign(styles, { ...others });
    });
  });

  return styles;
}

export default function traverseDOMTree(domAST: XParserNode, cssOM: XCSSAST) {
  const rootStyleNode = new StyleNode(domAST, {});

  function dfs(elem: XParserNode, parentStyleNode: StyleNode) {
    const rules = matchCSSRules(elem, cssOM.cssRules);
    const styles = handleRules(rules);
    const styleNode = new StyleNode(elem, styles);
    parentStyleNode.addChild(styleNode);
    if (elem.childNodes) {
      for (let i = 0; i < elem.childNodes.length; ++i) {
        dfs(elem.childNodes[i], styleNode);
      }
    }
  }
  for (let i = 0; i < domAST.childNodes.length; ++i) {
    dfs(domAST.childNodes[i], rootStyleNode);
  }
  return rootStyleNode;
}

const testDOM = {
  nodeName: "#document",
  childNodes: [
    {
      nodeName: "#text",
      data: "\n",
    },
    {
      nodeName: "html",
      attrs: {
        lang: "en",
      },
      childNodes: [
        {
          nodeName: "#text",
          data: "\n",
        },
        {
          nodeName: "body",
          attrs: {},
          childNodes: [
            {
              nodeName: "#text",
              data: "\n  ",
            },
            {
              nodeName: "div",
              attrs: {
                class: "main",
              },
              childNodes: [
                {
                  nodeName: "#text",
                  data: "hello",
                },
              ],
            },
            {
              nodeName: "#text",
              data: "\n  ",
            },
            {
              nodeName: "p",
              attrs: {
                id: "box",
              },
              childNodes: [],
            },
            {
              nodeName: "#text",
              data: "\n  ",
            },
            {
              nodeName: "img",
              attrs: {
                src: "./img/1.png",
                alt: "test",
              },
              childNodes: [],
            },
            {
              nodeName: "#text",
              data: "\n",
            },
          ],
        },
        {
          nodeName: "#text",
          data: "\n",
        },
      ],
    },
    {
      nodeName: "#text",
      data: "\n",
    },
  ],
};

const testCSSOM = {
  type: "CSSStyleSheet",
  cssRules: [
    {
      selectorText: "div,img",
      style: [
        {
          height: "100px",
          cssText: "height: 100px",
        },
        {
          width: "100px",
          cssText: "width: 100px",
        },
      ],
    },
    {
      selectorText: ".main",
      style: [
        {
          "font-size": "18px",
          cssText: "font-size: 18px",
        },
        {
          height: "200px",
          cssText: "height: 200px",
        }
      ],
    },
    {
      selectorText: "#box",
      style: [
        {
          "background-color": "rgb(100,100,100)",
          cssText: "background-color: rgb(100,100,100)",
        },
      ],
    },
  ],
};

