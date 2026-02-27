## Type

```go
type rtype struct {
    t abi.Type
}

type Type struct {
	Size_       uintptr
	PtrBytes    uintptr // number of (prefix) bytes in the type that can contain pointers
	Hash        uint32  // hash of type; avoids computation in hash tables
	TFlag       TFlag   // extra type information flags
	Align_      uint8   // alignment of variable with this type
	FieldAlign_ uint8   // alignment of struct field with this type
	Kind_       Kind    // what kind of type this is (string, int, ...)
	// function for comparing objects of this type
	// (ptr to object A, ptr to object B) -> ==?
	Equal func(unsafe.Pointer, unsafe.Pointer) bool
	// GCData stores the GC type data for the garbage collector.
	// Normally, GCData points to a bitmask that describes the
	// ptr/nonptr fields of the type. The bitmask will have at
	// least PtrBytes/ptrSize bits.
	// If the TFlagGCMaskOnDemand bit is set, GCData is instead a
	// **byte and the pointer to the bitmask is one dereference away.
	// The runtime will build the bitmask if needed.
	// (See runtime/type.go:getGCMask.)
	// Note: multiple types may have the same value of GCData,
	// including when TFlagGCMaskOnDemand is set. The types will, of course,
	// have the same pointer layout (but not necessarily the same size).
	GCData    *byte
	Str       NameOff // string form
	PtrToThis TypeOff // type for pointer to this type, may be zero
}

// arrayType represents a fixed array type. (代表固定长度的数组，如 [5]int)
type ArrayType struct {
    Type
    Elem  *Type // array element type
    Slice *Type // slice type
    Len   uintptr
}

// chanType represents a channel type. (代表通道，如 chan string)
type ChanType struct {
    Type
    Elem *Type
    Dir  ChanDir
}

// funcType represents a function type. (代表函数，如 func(int) bool)
type FuncType struct {
    Type
    InCount  uint16
    OutCount uint16 // top bit is set if last input parameter is ...
}
```

1. 对于基础类型（如 int, float64, bool）： 它们没有复杂的内部结构，所以它们的表示结构就到此为止了。一个 rtype 就足以完整描述它们。
2. 对于数组、切片、结构体等复合类型，光有一个 rtype（车头）是不够的，还需要追加特有的属性。在源码中，这部分通过两种语法来实现：类型别名和结构体嵌套



```json
{
  "_README": "以下所有十六进制地址 (如 0x...) 均为模拟的内存真实指针",

  "1_BasicType": {
    "_Example": "var a int64 = 100",
    "Underlying_Struct": "rtype",
    "Memory_Layout": {
      "t_abi_Type": {
        "Size_": 8,                 // 占用 8 字节
        "PtrBytes": 0,              // 包含指针的字节前缀长度为 0 (纯数字)
        "Hash": 2275765790,         // 编译期生成的类型唯一哈希值
        "TFlag": 1,                 // 1 表示 abi.TFlagRegularMemory (常规内存，无指针)
        "Align_": 8,                // 内存对齐基数
        "FieldAlign_": 8,           // 作为结构体字段时的对齐基数
        "Kind": 6,                  // reflect.Int64 的枚举常量值
        "Equal": "0x000000000045A120", // 指向汇编层面 int64 比较函数的指针
        "GCData": null              // 无指针，GC 无需扫描掩码，填 null
      }
    }
  },

  "2_PointerType": {
    "_Example": "var p *int64 = &a",
    "Underlying_Struct": "ptrType",
    "Memory_Layout": {
      "t_abi_Type": {
        "Size_": 8,                 // 64位系统指针本身占 8 字节
        "PtrBytes": 8,              // 它本身就是一个指针，所以前 8 字节是指针数据
        "Kind": 22,                 // reflect.Pointer 的枚举常量值
        "GCData": "0x000000000088B200" // 掩码位，告诉 GC 这是一个指针，需要顺藤摸瓜
      },
      "Elem": "0x000000000050A100"  // 【专属字段】指向 int64 的 rtype 首地址
    }
  },

  "3_ArrayType": {
    "_Example": "var arr [3]int64",
    "Underlying_Struct": "arrayType",
    "Memory_Layout": {
      "t_abi_Type": {
        "Size_": 24,                // 3 * 8 = 24 字节
        "PtrBytes": 0,              // 内部全是纯数字，无指针
        "Kind": 17                  // reflect.Array
      },
      "Elem": "0x000000000050A100", // 【专属字段】指向 int64 的 rtype 首地址
      "Slice": "0x000000000050C300",// 【专属字段】指向关联切片类型 []int64 的 rtype 地址
      "Len": 3                      // 【专属字段】数组固定长度
    }
  },

  "4_SliceType": {
    "_Example": "var s []string",
    "Underlying_Struct": "sliceType",
    "Memory_Layout": {
      "t_abi_Type": {
        "Size_": 24,                // 切片头 (Data, Len, Cap) 3 * 8 = 24 字节
        "PtrBytes": 8,              // 第一个字段 Data 是指针，占 8 字节
        "Kind": 23                  // reflect.Slice
      },
      "Elem": "0x000000000050B200"  // 【专属字段】指向 string 的 rtype 首地址
    }
  },

  "5_ChanType": {
    "_Example": "var c chan<- string",
    "Underlying_Struct": "chanType",
    "Memory_Layout": {
      "t_abi_Type": {
        "Size_": 8,                 // channel 底层是一个指向 hchan 结构体的指针，占 8 字节
        "PtrBytes": 8,              // 本身就是指针
        "Kind": 18                  // reflect.Chan
      },
      "Elem": "0x000000000050B200", // 【专属字段】指向 string 的 rtype 首地址
      "Dir": 2                      // 【专属字段】2 代表 SendDir (仅发送)
    }
  },

  "6_FuncType": {
    "_Example": "func(int, string) bool",
    "Underlying_Struct": "funcType",
    "Memory_Layout": {
      "t_abi_Type": {
        "Size_": 8,                 // 函数在底层表现为函数指针，占 8 字节
        "Kind": 19                  // reflect.Func
      },
      "InCount": 2,                 // 【专属字段】入参数量
      "OutCount": 1,                // 【专属字段】出参数量
      "_Hidden_Array_In_Memory": [  // 【底层隐藏字段】紧跟在 funcType 内存结构后的动态数组
        "0x000000000050A000",       // 入参 1 (int) 的 rtype 地址
        "0x000000000050B200",       // 入参 2 (string) 的 rtype 地址
        "0x000000000050C100"        // 出参 1 (bool) 的 rtype 地址
      ]
    }
  },

  "7_InterfaceType": {
    "_Example": "type Reader interface { Read(p []byte) (n int, err error) }",
    "Underlying_Struct": "interfaceType",
    "Memory_Layout": {
      "t_abi_Type": {
        "Size_": 16,                // iface 结构体占 16 字节 (tab 指针 + data 指针)
        "Kind": 20                  // reflect.Interface
      },
      "PkgPath": {                  // 【专属字段】包路径信息
        "Bytes": "0x000000000060A100" // 指向 "io" 字符串的内存
      },
      "Methods": [                  // 【专属字段】方法集 (数组)
        {
          "Name": 5678,             // 方法名 "Read" 在内存符号表中的相对偏移量
          "Typ": 1234               // 方法签名 func([]byte) (int, error) 的类型相对偏移量
        }
      ]
    }
  },

  "8_StructType_The_Boss": {
    "_Example": "type User struct { Name string `json:\"name\"`; Age int32 }",
    "Underlying_Struct": "structType",
    "Memory_Layout": {
      "t_abi_Type": {
        "Size_": 24,                // 字符串 16 + int32 4 + padding 对齐填充 4 = 24 字节
        "PtrBytes": 8,              // string 的底层首字段是指针，记录偏移
        "Kind": 25                  // reflect.Struct
      },
      "PkgPath": {
        "Bytes": "0x000000000060B200" // 指向 "main" 字符串的内存
      },
      "Fields": [                   // 【专属字段】结构体字段数组
        {
          "Name": "Name",
          "PkgPath": "",            // 首字母大写导出字段，该项为空
          "Type": "0x000000000050B200", // 指向 string 的 rtype 地址
          "Tag": "json:\"name\"",     // 真实的结构体 Tag
          "Offset": 0,              // 内存偏移量 0 字节
          "Anonymous": false
        },
        {
          "Name": "Age",
          "PkgPath": "",
          "Type": "0x000000000050D400", // 指向 int32 的 rtype 地址
          "Tag": "",
          "Offset": 16,             // 内存偏移量 16 字节 (跳过 Name 占据的 16 字节)
          "Anonymous": false
        }
      ]
    }
  },

  "9_Map类型_mapType_表示_字符串映射整型的哈希表": {
    "_example": "var m map[string]int64",
    "mapType": {
      "Type": {
        "Size_": 8,                 // Map 在底层只是一个指向 hmap 结构体的指针，占 8 字节
        "PtrBytes": 8,              // 本身就是指针，所以前 8 字节需要 GC 扫描
        "Hash": 9900112233,
        "TFlag": 0,
        "Align_": 8,
        "FieldAlign_": 8,
        "Kind": 21,                 // reflect.Map
        "Equal": null,              // Map 默认不能用 == 比较，所以比较函数为空
        "GCData": "0x000000000088B800",
        "Str": 9216,
        "PtrToThis": 0
      },
      "Key": "0x000000000050B200",  // 【核心】指向 Key 类型 (string) 的 rtype 首地址
      "Elem": "0x000000000050C300", // 【核心】指向 Value 类型 (int64) 的 rtype 首地址
      "Bucket": "0x000000000050D400",// 【隐藏 Boss】指向内部哈希桶 (bmap 结构体) 的 rtype 地址！
      "Hasher": "0x000000000045E120",// 【性能引擎】指向专门为 string 优化的快速哈希计算函数的指针
      "KeySize": 16,                // Key(string) 占用 16 字节
      "ValueSize": 8,               // Value(int64) 占用 8 字节
      "BucketSize": 208,            // 内部每个哈希桶的整体字节大小 (用于指针快速偏移寻址)
      "Flags": 1                    // 标记位（比如 Key 是否包含指针、是否需要内联等）
    }
  }
}
```

### 为什么 arrayType 有 Slice 字段，而 sliceType 没有？

在普通的 Go 代码里，编译器能轻松搞定这个转换。但如果在**反射（Reflection）**的动态世界里呢？
假设你通过反射拿到一个数组的值 v := reflect.ValueOf(arr)，然后你调用了 v.Slice(0, 3) 试图动态生成一个切片。
这时候，反射包面临一个难题：我生成的新切片，它的类型（*rtype）应该是什么？

如果没有这个 Slice 字段，反射包每次切片都需要：

取出数组的元素类型（int64）。

去全局的 lookupCache（一个带锁的并发 Map，源码里有定义）里查询或拼装出 []int64 的类型元数据。

这个过程涉及到锁竞争、哈希计算，极其耗时！

Go 的解决办法极其暴力且优雅：
既然数组 [5]int64 经常会被切片成 []int64，那编译器在编译阶段，干脆直接把 []int64 的类型指针算好，像个“快捷方式”一样硬塞进 arrayType 的 Slice 字段里。
反射切片时，直接 return arrayType.Slice，耗时从 O(N) 变成 O(1)。

为什么 sliceType 没有？
因为 sliceType 自身代表的已经是切片类型了（比如 []int64）。如果你要对一个切片再次进行切片操作（s[1:2]），产生的新切片类型依然是 []int64，类型根本没有发生改变，反射包直接复用当前的 *rtype 即可，完全不需要额外缓存其他类型的指针。