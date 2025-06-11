## Token生成方式

### [JSON Web Token](https://jwt.io/introduction)

[Web App Token 鉴权方案的设计与思考](https://zhuanlan.zhihu.com/p/28295641)

```JavaScript
const { createSecretKey, createPrivateKey } = require("crypto");

function createToken(payload, secret, options) {
  let secretOrPrivateKey = secret; // 为每个用户生成不同的secret key
  try {
    secretOrPrivateKey = createPrivateKey(secretOrPrivateKey);
  } catch (err) {
    secretOrPrivateKey = createSecretKey(secretOrPrivateKey);
  }
  payload = Object.assign({}, payload);
  const timestamp = payload.iat || Math.floor(Date.now() / 1000);
  payload.iat = timestamp;

  if (typeof options.expiresIn !== "undefined") {
    // 只考虑options.expiresIn为number类型
    payload.exp = timestamp + options.expiresIn;
  }
  const encoding = options.encoding || "utf8";

  return sign({
    header: header,
    payload: payload,
    secret: secretOrPrivateKey,
    encoding: encoding,
  });
}

function sign({ header, payload, secret, encoding }) {
  const algo = jwa(header.alg);
  const securedInput = jwsSecuredInput(header, payload, encoding);
  const signature = algo.sign(securedInput, secret);
  return util.format("%s.%s", securedInput, signature);
}

function jwsSecuredInput(header, payload, encoding) {
  const encodedHeader = base64url(toString(header), "binary");
  const encodedPayload = base64url(toString(payload), encoding);
  return util.format("%s.%s", encodedHeader, encodedPayload);
}

function base64url(string, encoding) {
  return Buffer.from(string, encoding)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
```

### 随机字符串

适用于会话Token

```JavaScript
// Node.js 环境
function generateCryptoToken(length = 32) {
  const crypto = require("crypto");
  return crypto.randomBytes(length).toString("hex");
}

// 浏览器环境
function generateBrowserToken(length = 32) {
  const array = new Uint8Array(length);
  window.crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}
```

### UUID

## [OAuth 2.0](https://www.ruanyifeng.com/blog/2019/04/oauth_design.html)

[OAuth 2.0 的四种方式](https://www.ruanyifeng.com/blog/2019/04/oauth-grant-types.html)
