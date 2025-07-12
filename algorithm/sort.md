## 快速排序

### 原理

选择一个基准元素，将待排序数组一分为二，左边是小于等于基准元素的部分，右边是大于等于基准元素的部分，并对左右两部分递归重复选基准+一分为二操作
在一分为二操作后，就可用得知基准元素是第x小（左边有x - 1个比基准元素小）或者说是第y大（右边有y - 1个比基准元素大）

### 复杂度

时间复杂度：一分为二+递归过程，每个递归耗时O(logn)，在递归过程中需要一分为二，耗时O(n)，故总时间需要O(n*logn)
空间复杂度：需要考虑递归栈中使用的变量所在的内存，故占用内存O(logn)

### 实现代码

```c++
void quick_sort(int q[], int l, int r)
{
    if (l >= r) return;

    int i = l - 1, j = r + 1, x = q[l + r >> 1];
    while (i < j)
    {
        do i ++ ; while (q[i] < x);
        do j -- ; while (q[j] > x);
        if (i < j) swap(q[i], q[j]);
    }
    quick_sort(q, l, j), quick_sort(q, j + 1, r);
}
```

## 归并排序

### 原理

从底往上对左右两个子数组进行排序
在子数组排序过程中可计算有多少逆序对（当要将左部分元素y放入临时数组时，右边有x个元素已经放入数组，说明y元素目前有x个逆序对）

### 复杂度

时间复杂度：递归+子数组排序耗时，递归需要O(logn)，每次递归都需要对子数组排序耗时O(n)，故总耗时为O(n*logn)
空间复杂度：子数组排序时需要额外的数组进行存储，故总占用内存为O(n)

### 实现代码

```c++
const int N = 1e5;
int tmp[N];
void merge_sort(int q[], int l, int r)
{
    if (l >= r) return;

    int mid = l + r >> 1;
    merge_sort(q, l, mid);
    merge_sort(q, mid + 1, r);

    int k = 0, i = l, j = mid + 1;
    while (i <= mid && j <= r)
        if (q[i] <= q[j]) tmp[k ++ ] = q[i ++ ];
        else tmp[k ++ ] = q[j ++ ];

    while (i <= mid) tmp[k ++ ] = q[i ++ ];
    while (j <= r) tmp[k ++ ] = q[j ++ ];

    for (i = l, j = 0; i <= r; i ++, j ++ ) q[i] = tmp[j];
}
```

## 堆排序

### 原理

分最小堆和最大堆，本质都是保证父节点小于/大于子节点，每次取出根节点时都是最小/大的元素
需要从最后一个父节点开始保证父节点小于/大于子节点，这样后续上层父节点才能拿到该子树中的最小/大元素
最后一个父节点元素位置为 i * 2 + 1 = n - 1 or i * 2 + 2 = n - 1，两个计算结果都是 n / 2 - 1（c++中int类型会截断）

### 复杂度

时间复杂度：需要考虑遍历+递归，遍历耗时O(n)，每次遍历节点需要递归保证父节点小于/大于子节点，耗时O(logn)，故总耗时O(n*logn)
空间复杂度：只需要对数组本身进行操作，故占用内存O(1)

### 代码实现

```c++
void heapify(vector<int>& arr, int n, int i) {
    int largest = i;
    int left = 2 * i + 1;
    int right = 2 * i + 2;
    
    if (left < n && arr[left] > arr[largest]) 
        largest = left;
        
    if (right < n && arr[right] > arr[largest]) 
        largest = right;
        
    if (largest != i) {
        swap(arr[i], arr[largest]);
        heapify(arr, n, largest);
    }
}

void heapSort(vector<int>& arr) {
    int n = arr.size();
    
    // 构建最大堆
    for (int i = n / 2 - 1; i >= 0; i--) {
        heapify(arr, n, i);
    }
    
    // 提取元素
    for (int i = n - 1; i > 0; i--) {
        swap(arr[0], arr[i]);
        heapify(arr, i, 0);
    }
}
```
