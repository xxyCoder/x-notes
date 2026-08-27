## HTMLFormElement

### 实例属性

* elements 包含此表单元素的所有表单控件（除了input type="image"），该实例属性继承HTMLCollection
* [name] 在控件中设置name值可以通过form.[name]直接访问

```HTML
<form>
  <input name='txt' />
</form>

<script>
  const form = document.querySelector('form');
  console.log(form.txt)
</script>
```

### 实例方法

* checkValidity() 如果满足约束返回true，否则触发不满足约束的控件上invalid方法，然后返回false
* reportValidity() 同checkValidity，区别在于会在页面中展示问题报告
* requestSubmit(submitter) 模拟用户点击提交按钮，会触发校验以及submit事件，可通过event.preventDefault阻止
* submit() 仅仅是提交
* reset() 重置表单

### 事件

* formdate 在构建FormDate或提交时触发

```JavaScript
form.addEventListener("formdata", (e) => {
  // 2. 获取表单数据对象
  const formData = e.formData;
  // 3. 修改数据（示例：追加新字段）
  formData.append("timestamp", Date.now());
  // 4. 修改现有字段值
  formData.set("username", "Modified_" + formData.get("username"));
});

// 5. 表单提交处理
form.addEventListener("submit", (e) => {
  e.preventDefault();
  // 6. 创建 FormData 对象（触发 formdata 事件）
  const data = new FormData(form);
  // 7. 发送数据（此时已包含修改后的数据）
  fetch("/submit", { method: "POST", body: data });
});
```

## FormData

提供了和URLSearchParams一样的实例方法

* validationMessage 只有在控件在提交时会自动校验并且不满足校验条件时才会返回字符串
* setCustomValidity() 定制校验失败时的报错信息
