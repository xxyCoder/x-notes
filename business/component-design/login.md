## 实现效果

1. 默认展示登录选项

![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=ZWEyYWM0YWY2ZDUxOGY5M2EzMmQ5ZWNjYjMzNjQyY2JfMDd1YmtUeUN0WFo1eFI5cHFnU3NmNnVFSnJZSVNnS1hfVG9rZW46VkExUmJtUDBYbzRPWll4MDdxRmMySkJObkw2XzE3NDA1NDk0NTg6MTc0MDU1MzA1OF9WNA)

2. 点击phone或者email后，按钮变为表单形式

![](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=YmFlOGI1YWJjNTlkZjljZTJjNWQxNjJiZDBjN2FlNWZfTTR4VGppbzl1V1pKb0l4UHEzTEswM2VHcGVjV1hOVzVfVG9rZW46Q1lkbGJHZWF4b3NZeUZ4SjFEdWNXNE1Qbm1oXzE3NDA1NDk0NTg6MTc0MDU1MzA1OF9WNA)

![img](https://lightweight.feishu.cn/space/api/box/stream/download/asynccode/?code=NDUzZGIzN2ViNjg1MGU1NjA5ODIyZDM2MDVhZTVlYzJfNDdRTE43OGs1aGdsTmVaemJPSDZKU0xrNE8yT2lTOHVfVG9rZW46VUM2dmJHOTFjbzVJRmh4T2JoVmNKQTRPbnljXzE3NDA1NDk0NTg6MTc0MDU1MzA1OF9WNA)

## 实现思路

### 不灵活的方式

1. 针对当前需求去实现，分为三个组件：LoginWithEmail、LoginWithPhone和LoginWithApple，组件抽象实现如下：

```JavaScript
// constant
const enum LoginMethod {
  Phone,
  Email,
  Apple
}
// father component
const [currenSelectedMethod, setCurrenSelectedMethod] = useState<LoginMethod | ''>('')
return <>
  !currenSelectedMethod && <>
    <button>Continue With Phone</button>
    <button>Continue With Email</button>
    <button>Continue With Apple</button>
  </>
  
  currenSelectedMethod === LoginMethod.Phone && <LoginWithPhone />
  currenSelectedMethod === LoginMethod.Eamil && <LoginWithEmail />
  currenSelectedMethod === LoginMethod.Apple && <LoginWithApple />
</>


// component
const LoginWithXxx1: FC = ({ onClick }) => {
  <>
    <div>...</div>
    <hr />
    <button onClick={() => onClick('Xxx2')}>Continue With Xxx2</button>
    <button onClick={() => onClick('Xxx3')}>Continue With Xxx3</button>
  </>
}
```

2. 为什么说不灵活呢，因为登录方式有多种，目前只是接入三种，后期要新增的话不得不在父组件以及其他登录方式组件中添加代码，非常麻烦，而且新人接手可能会遗漏。

### 灵活的方式

1. 各个登录组件只维护当前登录方式的可点击按钮（Continue With Xxxx）和点击后展开组件，从而隔离其他组件变化；
2. 为了保证登录方式顺序，可以排序展示，如果是被选中的登录方式则优先展示，其余按照index顺序排序。

```JavaScript
// component
const LoginWithXxx: FC<{}> = ({ currenSelectedMethod, onClick }) => {
  currenSelectedMethod === LoginMethod.Xxx ? 
      <>...</> : 
      <button onClick={() => onClick(LoginMethod.Xxx)}>Continue With Xxx</button>
}

// constant
const enum LoginMethod {
  Phone,
  Email,
  Apple
}

// father component
const [currenSelectedMethod, setCurrenSelectedMethod] = useState<LoginMethod | ''>('')
const loginComponents = [
  { node: LoginWithPhone, index: LoginMethod.Phone },
  { node: LoginWithEmail, index: LoginMethod.Email },
  { node: LoginWithApple, index: LoginMethod.Apple }
]

return loginComponents.sort((l1, l2) => currenSelectedMethod === l1.index ? -1 : l1.index - l2.index).map(({ node, index }) => <div key={index}>{node}</div>);
```
