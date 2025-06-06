interface XCSSStyleDeclaration {
  cssText: string // CSS样式文本
  length: number // 样式属性的数量
  parentRule: XCSSRule | null // 如果该样式声明是某个规则的一部分，则为该规则
  color: string // 示例属性，实际可包含更多CSS属性
  fontSize: string 
}

export class XCSSRule {
  cssText: string
  selectorText: string
  parentStyleSheet: XCSSStyleSheet | null
  style: XCSSStyleDeclaration
}

class XCSSImportRule {
  cssText: string
  href: string
  parentStyleSheet: XCSSStyleSheet | null // @import规则所在的文件
  styleSheet: XCSSStyleSheet
}

class XCSSMediaRule {
  conditionText: string // @media规则的条件文本
  cssRules: XCSSRuleList // @media规则包含的CSS规则
  media: Array<{
    mediaText: string
  }>
  parentStyleSheet: XCSSStyleSheet | null // @media规则所在的文件
}

type XCSSRuleList = (XCSSRule | XCSSImportRule | XCSSMediaRule)[]

export class XCSSStyleSheet {
  disabled: boolean
  parentStyleSheet: XCSSStyleSheet | null
  cssRules: XCSSRuleList

  insertRule(rule: XCSSRule | XCSSImportRule | XCSSMediaRule, index = 0): number {
    if (index > this.cssRules.length) {
      throw new Error('Index out of bounds')
    }
    this.cssRules.splice(index, 0, rule)
    return index
  }

  deleteRule(index: number): void {
    if (index < 0 || index >= this.cssRules.length) {
      throw new Error('Index out of bounds')
    }
    this.cssRules.splice(index, 1)
  }
}

// document.styleSheets
type XStylesheetList = XCSSStyleSheet[]
