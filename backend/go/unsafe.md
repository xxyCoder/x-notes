## Pointer

```go
// ArbitraryType is here for the purposes of documentation only and is not actually
// part of the unsafe package. It represents the type of an arbitrary Go expression.
type ArbitraryType int

type Pointer *ArbitraryType
```

表示指向任意类型的指针。该类型支持四种其他类型不具备的特殊操作

1. 任意类型的指针值均可转换为 Pointer 类型
2. Pointer 类型可转换为任意类型的指针值
3. uintptr 类型可转换为 Pointer 类型
4. Pointer 类型可转换为 uintptr 类型

另外 ArbitraryType 在这里仅仅是为了生成文档的目的，它实际上根本不是 unsafe 包的一部分。

基于指针的强制类型转换非常高效，因为不会生成任何多余的指令，也不会额外分配内存，只是让编译器换了一种方式来解释内存中的数据；而基于值的强制类型转换会多一条指令：重新组装为符合的新二进制格式

### Add

```go
// The function Add adds len to ptr and returns the updated pointer
// [Pointer](uintptr(ptr) + uintptr(len)). => 其底层逻辑等价于 Pointer(uintptr(ptr) + uintptr(len))
// The len argument must be of integer type or an untyped constant.
// A constant len argument must be representable by a value of type int;
// if it is an untyped constant it is given type int.
// The rules for valid uses of Pointer still apply.
func Add(ptr Pointer, len IntegerType) Pointer

type IntegerType int
```

## uintptr

本质就是一个无符号整数，表示一个指针的地址值

## Slice

```go
// The function Slice returns a slice whose underlying array starts at ptr
// and whose length and capacity are len.
// Slice(ptr, len) is equivalent to
//
//	(*[len]ArbitraryType)(unsafe.Pointer(ptr))[:]
//
// except that, as a special case, if ptr is nil and len is zero,
// Slice returns nil.
//
// The len argument must be of integer type or an untyped constant.
// A constant len argument must be non-negative and representable by a value of type int;
// if it is an untyped constant it is given type int.
// At run time, if len is negative, or if ptr is nil and len is not zero,
// a run-time panic occurs.
func Slice(ptr *ArbitraryType, len IntegerType) []ArbitraryType

// SliceData returns a pointer to the underlying array of the argument
// slice.
//   - If cap(slice) > 0, SliceData returns &slice[:1][0].
//   - If slice == nil, SliceData returns nil.
//   - Otherwise, SliceData returns a non-nil pointer to an
//     unspecified memory address.
func SliceData(slice []ArbitraryType) *ArbitraryType
```

1. `Slice` 返回一个 slice 切片，`slice.Data` 为 `ptr`，`slice.Len` 和 `slice.Cap` 均为 `len`
2. `SliceData` 返回传入切片的 `slice.Data`

## String

```go
// String returns a string value whose underlying bytes
// start at ptr and whose length is len.
//
// The len argument must be of integer type or an untyped constant.
// A constant len argument must be non-negative and representable by a value of type int;
// if it is an untyped constant it is given type int.
// At run time, if len is negative, or if ptr is nil and len is not zero,
// a run-time panic occurs.
//
// Since Go strings are immutable, the bytes passed to String
// must not be modified as long as the returned string value exists.
func String(ptr *byte, len IntegerType) string

// StringData returns a pointer to the underlying bytes of str.
// For an empty string the return value is unspecified, and may be nil.
//
// Since Go strings are immutable, the bytes returned by StringData
// must not be modified.
func StringData(str string) *byte
```

1. `String` 返回新字符串，其中 `string.Data` 指定为 `ptr`，`string.Len` 指定为 `len`
2. `StringData` 返回 `string.Data`