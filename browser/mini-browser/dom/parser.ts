import { XNodeType } from "./index.ts";

const testHTML = `
<html lang="en">
<body>
  <h1 class="hh">
    hello world
    <span>xxyCoder</span>
  </h1>
  <img src='./img/1.png' alt='test' />
</body>
</html>
`;

interface XToken {
  nodeType: XNodeType;
  nodeName: string;
  attrs?: Record<string, string>;
  data?: string;
  type: string;
}

// 词法分析器
class HTMLLexer {
  input: string;
  position: number;
  tokens: XToken[];
  constructor(input: string) {
    this.input = input;
    this.position = 0;
    this.tokens = [];
  }

  tokenize() {
    while (this.position < this.input.length) {
      let char = this.input[this.position];

      if (char === "<") {
        this.parseTag();
        continue;
      }

      this.parseText();
    }
    return this.tokens;
  }

  parseTag() {
    ++this.position;
    const isCloseTag = this.input[this.position] === "/";
    if (isCloseTag) {
      ++this.position;
    }
    const tagName = this.input.slice(this.position).match(/^[\w]+/)?.[0];
    if (!tagName) {
      throw new Error("Invalid tag name");
    }
    this.position += tagName.length;

    const attrs = this.parseAttributes();

    const isSelfCloseTag = this.input[this.position] === "/";
    if (isSelfCloseTag) {
      ++this.position;
    }
    this.tokens.push({
      type: isCloseTag ? "closeTag" : isSelfCloseTag ? "selfCloseTag" : "openTag",
      nodeType: XNodeType.Element,
      nodeName: tagName,
      attrs,
    });
    ++this.position; // 跳过 >
  }

  parseAttributes() {
    const attrs = {};
    while (this.position < this.input.length) {
      this.skipWhitespace();
      const char = this.input[this.position];
      if (char === ">" || char === "/") {
        break;
      }

      const attrName = this.input.slice(this.position).match(/^[\w-]+/)?.[0];
      if (!attrName) {
        break;
      }
      this.position += attrName.length;
      let attrValue = "";
      if (this.input[this.position] === "=") {
        ++this.position;
        const quote = this.input[this.position];
        if (quote === '"' || quote === "'") {
          ++this.position;
          const endIdx = this.input.indexOf(quote, this.position);
          if (endIdx === -1) {
            throw new Error("Unterminated attribute value");
          }
          attrValue = this.input.slice(this.position, endIdx);
          this.position = endIdx + 1;
        }
      }
      attrs[attrName] = attrValue;
    }
    return attrs;
  }

  parseText() {
    const endIdx = this.input.indexOf("<", this.position);
    const text =
      endIdx === -1
        ? this.input.slice(this.position)
        : this.input.slice(this.position, endIdx);
    this.tokens.push({
      type: 'text',
      nodeType: XNodeType.Text,
      nodeName: "#text",
      data: text,
    });
    this.position += text.length;
  }

  skipWhitespace() {
    while (/\s/.test(this.input[this.position])) this.position++;
  }
}

interface XNode {
  nodeName: string
  childNodes: XNode[]
  attrs?: Record<string, string>;
  data?: string;
}

class HTMLParser {
  tokens: XToken[];
  position: number;
  ast: XNode;
  stack: XNode[];
  constructor(tokens: XToken[]) {
    this.tokens = tokens;
    this.position = 0;
    this.ast = {
      nodeName: "#document",
      childNodes: [],
    };
    this.stack = [this.ast];
  }

  parse() {
    while (this.position < this.tokens.length) {
      const token = this.tokens[this.position];

      switch (token.type) {
        case "openTag":
        case "selfCloseTag":
          this.parseElement(token);
          break;
        case "closeTag":
          const top = this.stack.pop();
          if (top?.nodeName !== token.nodeName) {
            throw new Error(
              `Mismatched closing tag: expected </${top?.nodeName}>, got </${token.nodeName}>`
            );
          }
          ++this.position;
          break;
        case "text":
          this.parseText(token);
          break;
        default:
          throw new Error(`Unknown token type: ${token.type}`);
      }
    }
  }

  get currentNode() {
    return this.stack[this.stack.length - 1];
  }

  parseElement(token: XToken) {
    const element = {
      nodeName: token.nodeName,
      attrs: token.attrs,
      childNodes: [],
    };
    this.currentNode.childNodes.push(element);
    if (token.type !== "selfCloseTag") {
      this.stack.push(element);
    }
    ++this.position;
  }

  parseText(token: XToken) {
    this.currentNode.childNodes.push({
      nodeName: "#text",
      data: token.data,
      childNodes: []
    });
    ++this.position;
  }
}

export function compileHTML(html) {
  const htmlLexer = new HTMLLexer(html);
  const tokens = htmlLexer.tokenize();

  const htmlParser = new HTMLParser(tokens);
  htmlParser.parse();
  return htmlParser.ast;
}