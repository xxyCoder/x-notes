```python
class Request(HTTPConnection):
    _form: FormData | None

    def __init__(self, scope: Scope, receive: Receive = empty_receive, send: Send = empty_send):
        super().__init__(scope)
        assert scope["type"] == "http"
        self._receive = receive
        self._send = send
        self._stream_consumed = False
        self._form = None

    async def stream(self) -> AsyncGenerator[bytes, None]:
        if hasattr(self, "_body"):
            yield self._body
            yield b""
            return
        if self._stream_consumed:
            raise RuntimeError("Stream consumed")
        while not self._stream_consumed:
            message = await self._receive()
            if message["type"] == "http.request":
                body = message.get("body", b"")
                if not message.get("more_body", False):
                    self._stream_consumed = True
                if body:
                    yield body
            elif message["type"] == "http.disconnect":  # pragma: no branch
                self._is_disconnected = True
                raise ClientDisconnect()
        yield b""

    async def body(self) -> bytes:
        if not hasattr(self, "_body"):
            chunks: list[bytes] = []
            async for chunk in self.stream():
                chunks.append(chunk)
            self._body = b"".join(chunks)
        return self._body

    async def json(self) -> Any:
        if not hasattr(self, "_json"):  # pragma: no branch
            body = await self.body()
            self._json = json.loads(body)
        return self._json

    async def _get_form(
        self,
        *,
        max_files: int | float = 1000,
        max_fields: int | float = 1000,
        max_part_size: int = 1024 * 1024,
    ) -> FormData:
        if self._form is None:  # pragma: no branch
            assert parse_options_header is not None, (
                "The `python-multipart` library must be installed to use form parsing."
            )
            content_type_header = self.headers.get("Content-Type")
            content_type: bytes
            content_type, _ = parse_options_header(content_type_header)
            if content_type == b"multipart/form-data":
                try:
                    multipart_parser = MultiPartParser(
                        self.headers,
                        self.stream(),
                        max_files=max_files,
                        max_fields=max_fields,
                        max_part_size=max_part_size,
                    )
                    self._form = await multipart_parser.parse()
                except MultiPartException as exc:
                    if "app" in self.scope:
                        raise HTTPException(status_code=400, detail=exc.message)
                    raise exc
            elif content_type == b"application/x-www-form-urlencoded":
                form_parser = FormParser(self.headers, self.stream())
                self._form = await form_parser.parse()
            else:
                self._form = FormData()
        return self._form

    def form(
        self,
        *,
        max_files: int | float = 1000,
        max_fields: int | float = 1000,
        max_part_size: int = 1024 * 1024,
    ) -> AwaitableOrContextManager[FormData]:
        return AwaitableOrContextManagerWrapper(
            self._get_form(max_files=max_files, max_fields=max_fields, max_part_size=max_part_size)
        )

    async def close(self) -> None:
        if self._form is not None:  # pragma: no branch
            await self._form.close()

```

1. stream为核心字节流处理器，
   * 它的作用是逐块（Chunk）获取原始的二进制数据，使用 `_stream_consumed` 标记流是否被读完。ASGI 规定 Request Body 只能被读取一次
   * 通过 `await self._receive()` 等待 ASGI 服务器（如 Uvicorn）发来的消息
2. body是对stream方法的二次封装，目的是一次性拿到完整的二进制数据
   * 允许多次读
3. json是对于body方法的二次封装，目的是拿到反序列化的数据
4. form用于处理 `POST` 请求中常见的表单数据

## async for语法

传统for中，每次获取下一个元素（调用next）都是同步阻塞的，而async for可以暂时挂起当前任务，让事件循环去处理其他事情，等数据到了再回来继续

需要实现 `__aiter__`（返回一个异步迭代器对象）和 `__aexit__`（返回一个Awaitable对象，也就是说如果还有数据，返回下一个值；如果没有数据了，抛出 `StopAsyncIteration` 异常。）

```python
import asyncio

class AsyncCounter:
    def __init__(self, stop):
        self.current = 0
        self.stop = stop

    def __aiter__(self):
        return self

    async def __anext__(self):
        await asyncio.sleep(1)  # 模拟 IO 等待
        if self.current < self.stop:
            self.current += 1
            return self.current
        else:
            raise StopAsyncIteration  # 结束标志

async def main():
    # 使用 async for
    async for num in AsyncCounter(3):
        print(num)

asyncio.run(main())
```

也可以结合生成器

```python
async def async_generator(stop):
    for i in range(1, stop + 1):
        await asyncio.sleep(1)
        yield i  # 这里的 yield 会自动处理 StopAsyncIteration

async def main():
    async for num in async_generator(3):
        print(num)
```
