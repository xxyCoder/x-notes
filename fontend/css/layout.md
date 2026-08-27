## flex布局

### 设置display: flex，子项的变化
1. 子项块状化，宽度为格式化尺寸；
2. 子项浮动失效；
3. 支持z-index属性设置；
4. margin不会合并；
5. overflow: auto | scroll会失效；

### 属性解释
1. justify表示布局主轴样式设置
2. align表示布局副轴样式设置
3. items表示全体中各自样式的设置
4. content表示布局整体的样式设置
5. self表示元素设置的设置，在子元素身上设置

### flex属性细节
1. flex: flex-grow flex-shrink flex-basis

#### flex-grow
1. 所有的剩余空间表示为1
2. 如果只有一个flex子项设置了flex-grow
   
   a. flex-grow < 1，则扩展空间为 flex-grow * 剩余空间
   
   b. flex-grow >= 1，则扩展空间为剩余空间
4. 如果有多个flex子项设置了flex-grow
   
   a. 所有子项的flex-grow总和 < 1，则各自扩展空间为各自flex-grow * 剩余空间
   
   b. 所有子项的flex-grow总和 >= 1，则各自扩展空间为flex / 总和flex-grow * 剩余空间

#### flex-shrink
- 规则和flex-grow一致，只不过flex-grow是扩展空间，而flex-shrink是收缩空间

#### flex-basis
- flex子项最终占据宽度受flex-grow、flex-shrink、flex-basis、最大最小尺寸和width影响
  
  - 最大最小尺寸 > flex-grow、flex-shrink > 基础尺寸（flex-basis > width）
    
1. flex-basis和width一样，都是作用在content-box上的
2. flex-basis有值则忽略width，如果为auto则使用width作为基础值
3. 最小尺寸min-width > min(width === 'auto' ? Infinity : width, 最小内容宽度)
4. 最大尺寸max-width影响

### flex常用属性值
1. flex: 0 => flex: 0 1 0%，表现为有剩余空间不扩展，空间不足则收缩，宽度为min-content
2. flex: 1 => flex: 1 1 0%，表现为有剩余空间则扩展，空间不足则收缩，宽度为min-content
3. flex: auto => flex: 1 1 auto，表现为有剩余空间则扩展，空间不足则收缩，宽度随内容自适应
4. flex: none => flex: 0 0 auto，表现为有剩余空间不扩展，空间不足不收缩，宽度随内容自适应
5. flex: initial => flex: 0 1 auto，表现为有剩余空间不扩展，空间不足则收缩，宽度随内容自适应
