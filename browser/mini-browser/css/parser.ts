const testCSS = `
#id {
  color: red;
  width: 100px;
  height: 100px;
}
.class {
  background: rgb(100,100,100);
}
div,span {
  font-size: 12px;
}
`;

interface XToken {
  type: string
  selectorText?: string
  attrKey?: string
  attrValue?: string
}

class CSSLexer {
  input: string
  position: number
  tokens: XToken[]
  constructor(input: string) {
    this.input = input;
    this.position = 0;
    this.tokens = [];
  }

  isWhitespace(char: string) {
    return /\s/.test(char);
  }

  consumeWhitespace() {
    while (
      this.position < this.input.length &&
      this.isWhitespace(this.input[this.position])
    ) {
      ++this.position;
    }
  }

  tokenize() {
    while (this.position < this.input.length) {
      this.consumeWhitespace();
      if (this.position >= this.input.length) {
        break;
      }
      const char = this.input[this.position];
      if (char === "." || char === "#" || /[a-zA-Z]/.test(char)) {
        this.parseSelector();
      }
      if (char === "{") {
        this.parseAttribute();
      }
    }
    return this.tokens;
  }

  parseSelector() {
    const selector = this.input
      .slice(this.position)
      .match(/[\.#]?\w+(,[\.#]?\w+)*/)?.[0];
    if (!selector) {
      throw new Error("No selector");
    }
    this.position += selector.length;
    this.tokens.push({
      type: "selector",
      selectorText: selector,
    });
  }

  parseAttribute() {
    ++this.position;
    do {
      this.consumeWhitespace();
      const char = this.input[this.position];
      if (char === "}") {
        this.tokens.push({
          type: "right parenthesis",
        });
        ++this.position;
        break;
      }
      const attrKey = this.input.slice(this.position).match(/[-a-zA-Z]+/)?.[0];
      if (!attrKey) {
        throw new Error('No attribute Key')
      }
      this.position += attrKey.length;
      this.consumeWhitespace();
      ++this.position; // 跳过:
      this.consumeWhitespace();
      const attrValue = this.input
        .slice(this.position)
        .match(/[-a-zA-Z0-9\(\),]+/)?.[0];
      if (!attrValue) {
        throw new Error('No attribute value')
      }
      this.position += attrValue.length;
      this.consumeWhitespace();
      ++this.position; // 跳过;

      this.tokens.push({
        type: "style",
        attrKey,
        attrValue,
      });
    } while (true);
  }
}

interface CSSRule {
  selectorText: string
  style: Record<string, string>[]
}

interface CSSAST {
  type: string
  cssRules: Array<CSSRule>
}

class CSSParser {
  tokens: XToken[]
  position: number
  ast: CSSAST
  stack: (CSSAST | CSSRule)[]
  constructor(tokens: XToken[]) {
    this.tokens = tokens;
    this.position = 0;
    this.ast = {
      type: "CSSStyleSheet",
      cssRules: [],
    };
    this.stack = [this.ast];
  }

  get currentToken() {
    return this.stack[this.stack.length - 1];
  }

  parse() {
    while (this.position < this.tokens.length) {
      const token = this.tokens[this.position];

      switch (token.type) {
        case "selector":
          this.parseSelector();
          break;
        case "right parenthesis":
          this.stack.pop();
          ++this.position;
          break;
        case "style":
          this.parseStyle();
          break;
        default:
          ++this.position;
      }
    }
    return this.ast;
  }

  parseSelector() {
    const currentSheet = this.currentToken as CSSAST;
    const token = this.tokens[this.position];
    const cssRule = {
      selectorText: token.selectorText!,
      style: [],
    };
    currentSheet.cssRules.push(cssRule);
    ++this.position;
    this.stack.push(cssRule);
  }

  parseStyle() {
    const currentRule = this.currentToken as CSSRule;
    const token = this.tokens[this.position];
    ++this.position;
    currentRule.style.push({
      [token.attrKey!]: token.attrValue!,
      cssText: `${token.attrKey}: ${token.attrValue}`,
    });
  }
}

export default function compile() {
  const cssLexer = new CSSLexer(testCSS);
  const tokens = cssLexer.tokenize();
  const cssParser = new CSSParser(tokens);
  return cssParser.parse();
}

