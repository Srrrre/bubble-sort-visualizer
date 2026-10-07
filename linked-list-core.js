(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LinkedListCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const MAX_NODES = 12;
  const NODE_DEFINITION = 'struct Node {\n    int val;\n    Node* next;\n};';
  const CODES = {
    traverse: {
      title: '遍历链表',
      lines: [
        'void traverse(Node* head) {',
        '    Node* p = head;',
        '    while (p != nullptr) {',
        '        cout << p->val << " ";',
        '        p = p->next;',
        '    }',
        '    return;',
        '}'
      ],
      complexity: '时间 O(n)，算法辅助空间 O(1)。记录访问结果额外使用 O(n)；可视化每个快照还保存节点副本。'
    },
    search: {
      title: '按值查找第一个匹配节点',
      lines: [
        'int findFirst(Node* head, int value) {',
        '    Node* p = head;',
        '    int position = 1;',
        '    while (p != nullptr) {',
        '        if (p->val == value) {',
        '            return position;',
        '        }',
        '        p = p->next;',
        '        ++position;',
        '    }',
        '    return -1;',
        '}'
      ],
      complexity: '最好时间 O(1)，最坏时间 O(n)；算法辅助空间 O(1)。可视化快照和比较记录另占空间。'
    },
    insert: {
      title: '按位置插入（从 1 计数）',
      lines: [
        'bool insertAt(Node*& head, int& n, int position, int value) {',
        '    if (position < 1 || position > n + 1 || n >= 12 || value < -99 || value > 99) return false;',
        '    Node* prev = nullptr;',
        '    if (position > 1) {',
        '        prev = head;',
        '        for (int i = 1; i < position - 1; ++i) {',
        '            prev = prev->next;',
        '        }',
        '    }',
        '    Node* newNode = new Node{value, nullptr};',
        '    if (prev == nullptr) {',
        '        newNode->next = head;',
        '        head = newNode;',
        '    } else {',
        '        newNode->next = prev->next;',
        '        prev->next = newNode;',
        '    }',
        '    ++n;',
        '    return true;',
        '}'
      ],
      complexity: '寻找前驱最坏 O(n)，修改两处指针 O(1)；头插 O(1)，按位置插入整体最坏 O(n)。算法辅助空间 O(1)，新节点 O(1)；可视化快照另占空间。'
    },
    delete: {
      title: '按位置删除（从 1 计数）',
      lines: [
        'bool eraseAt(Node*& head, int& n, int position) {',
        '    if (position < 1 || position > n) return false;',
        '    Node* prev = nullptr;',
        '    if (position > 1) {',
        '        prev = head;',
        '        for (int i = 1; i < position - 1; ++i) {',
        '            prev = prev->next;',
        '        }',
        '    }',
        '    Node* target = prev == nullptr ? head : prev->next;',
        '    if (prev == nullptr) {',
        '        head = target->next;',
        '    } else {',
        '        prev->next = target->next;',
        '    }',
        '    delete target;',
        '    target = nullptr;',
        '    --n;',
        '    return true;',
        '}'
      ],
      complexity: '寻找前驱最坏 O(n)，绕过并删除节点 O(1)；头删 O(1)，按位置删除整体最坏 O(n)。算法辅助空间 O(1)；可视化快照另占空间。'
    },
    reverse: {
      title: '迭代反转：保存、改向、前进',
      lines: [
        'void reverseList(Node*& head) {',
        '    Node* prev = nullptr;',
        '    Node* curr = head;',
        '    Node* next = nullptr;',
        '    while (curr != nullptr) {',
        '        next = curr->next;',
        '        curr->next = prev;',
        '        prev = curr;',
        '        curr = next;',
        '    }',
        '    head = prev;',
        '    return;',
        '}'
      ],
      complexity: '每个节点处理一次，时间 O(n)，三指针的算法辅助空间 O(1)。可视化每步复制全部节点；若保留 O(n) 步快照，总额外空间为 O(n²)。'
    }
  };

  function freezeDeep(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freezeDeep);
      Object.freeze(value);
    }
    return value;
  }
  freezeDeep(CODES);

  function integer(value, label) {
    if (typeof value === 'string') {
      if (!/^[+-]?\d+$/.test(value.trim())) throw new Error(label + '必须填写整数。');
      value = Number(value.trim());
    }
    if (!Number.isSafeInteger(value)) throw new Error(label + '必须填写整数。');
    return value;
  }

  function nodeValue(value) {
    const normalized = integer(value, '节点值');
    if (normalized < -99 || normalized > 99) throw new Error('节点值必须在 -99～99 之间。');
    return normalized;
  }

  function parseValues(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('请输入 1～12 个整数；创建空链表请使用“清空链表”。');
    const tokens = text.trim().split(/[,，\s]+/).filter(Boolean);
    if (!tokens.length) throw new Error('请输入整数，不能只有分隔符。');
    if (tokens.length > MAX_NODES) throw new Error('链表最多包含 12 个节点。');
    return tokens.map((token, index) => {
      if (!/^[+-]?\d+$/.test(token)) throw new Error('第 ' + (index + 1) + ' 个值“' + token + '”不是整数；请使用逗号或空格分隔。');
      return nodeValue(token);
    });
  }

  function createList(values) {
    if (!Array.isArray(values)) throw new Error('创建链表需要整数数组。');
    if (values.length > MAX_NODES) throw new Error('链表最多包含 12 个节点。');
    const nodes = {};
    for (let i = 0; i < values.length; i++) {
      if (typeof values[i] !== 'number') throw new Error('节点值必须是数值类型的整数。');
      const id = 'N' + (i + 1);
      nodes[id] = { id, val: nodeValue(values[i]), next: i + 1 < values.length ? 'N' + (i + 2) : null };
    }
    return { nodes, head: values.length ? 'N1' : null, length: values.length, nextId: values.length + 1 };
  }

  function cloneList(model) {
    const nodes = {};
    // 遍历节点表而非 head：反转和插删途中，暂不可达的节点也仍然存活。
    for (const [id, node] of Object.entries(model.nodes)) nodes[id] = { ...node };
    return { nodes, head: model.head, length: model.length, nextId: model.nextId };
  }

  function reachableIds(model) {
    const ids = [];
    const seen = new Set();
    let p = model.head;
    while (p !== null) {
      if (!model.nodes[p]) throw new Error('发现悬空引用：节点 ' + p + ' 不存在。');
      if (seen.has(p)) throw new Error('链表意外形成了环。');
      seen.add(p);
      ids.push(p);
      p = model.nodes[p].next;
    }
    return ids;
  }

  function validateOperation(model, operation, args = {}) {
    if (!Object.prototype.hasOwnProperty.call(CODES, operation)) throw new Error('未知的链表操作。');
    const ids = reachableIds(model);
    if (ids.length !== model.length || ids.length !== Object.keys(model.nodes).length) throw new Error('当前链表结构不完整，请先重置本次操作。');
    const normalized = {};
    if (operation === 'insert' || operation === 'delete') {
      normalized.position = integer(args.position, '位置');
      const max = model.length + (operation === 'insert' ? 1 : 0);
      if (max === 0) throw new Error('空链表不能删除节点。');
      if (normalized.position < 1 || normalized.position > max) throw new Error('当前位置必须在 1～' + max + ' 之间（从 1 计数）。');
    }
    if (operation === 'insert' && model.length >= MAX_NODES) throw new Error('链表已达到 12 个节点上限，请先删除节点。');
    if (operation === 'insert' || operation === 'search') normalized.value = nodeValue(args.value);
    return normalized;
  }

  function* operationSteps(original, operation, input = {}) {
    const args = validateOperation(original, operation, input);
    const model = cloneList(original);
    const pointers = { p: null, prev: null, curr: null, next: null, newNode: null, target: null };
    const releasedPointers = {};
    const visited = [];
    const visitedIds = new Set();
    const reversedIds = new Set();
    let result;

    function snapshot(statement, message, type = 'pointer', done = false) {
      const line = CODES[operation].lines.findIndex(code => code.trim() === statement) + 1;
      if (!line) throw new Error('教学步骤未关联参考代码：' + statement);
      const roles = {};
      function add(id, role) {
        if (id && model.nodes[id]) {
          if (!roles[id]) roles[id] = [];
          if (!roles[id].includes(role)) roles[id].push(role);
        }
      }
      visitedIds.forEach(id => add(id, '已访问'));
      reversedIds.forEach(id => add(id, '已反转'));
      if (operation === 'reverse') {
        Object.keys(model.nodes).forEach(id => { if (!reversedIds.has(id)) add(id, '未处理'); });
      }
      add(pointers.p, '当前');
      add(pointers.curr, '当前');
      add(pointers.prev, operation === 'reverse' ? '已反转入口' : '前驱');
      add(pointers.newNode, done ? '已插入' : '待插入');
      add(pointers.target, '待删除');
      return freezeDeep({ model: cloneList(model), pointers: { ...pointers }, releasedPointers: { ...releasedPointers }, roles, visited: [...visited], line, message, type, done, ...(result ? { result: { ...result } } : {}) });
    }

    if (operation === 'traverse') {
      pointers.p = model.head;
      yield snapshot('Node* p = head;', pointers.p ? 'p 从 head 开始，指向 ' + pointers.p + '。' : '空链表中 head 为 nullptr，因此 p 也为 nullptr。');
      while (pointers.p !== null) {
        yield snapshot('while (p != nullptr) {', 'p 指向有效节点，可以访问其数据域。', 'compare');
        const current = model.nodes[pointers.p];
        visited.push(current.val);
        visitedIds.add(current.id);
        yield snapshot('cout << p->val << " ";', '访问 ' + current.id + '，记录值 ' + current.val + '。', 'visit');
        pointers.p = current.next;
        yield snapshot('p = p->next;', pointers.p ? '沿 next 前进，p 现在指向 ' + pointers.p + '。' : '沿尾节点的 next 前进，p 到达 nullptr。');
      }
      yield snapshot('return;', '遍历完成，已访问 ' + visited.length + ' 个节点。', 'done', true);
      return;
    }

    if (operation === 'search') {
      pointers.p = model.head;
      yield snapshot('Node* p = head;', pointers.p ? '从 head 开始查找值 ' + args.value + '。' : '链表为空，p = nullptr，没有可比较的节点。');
      let position = 1;
      yield snapshot('int position = 1;', '位置从 1 开始计数，与界面输入规则一致。');
      while (pointers.p !== null) {
        const current = model.nodes[pointers.p];
        yield snapshot('while (p != nullptr) {', 'p 尚未到达 nullptr，继续检查当前节点。', 'compare');
        visited.push(current.val);
        visitedIds.add(current.id);
        const match = current.val === args.value;
        yield snapshot('if (p->val == value) {', current.id + ' 的值 ' + current.val + (match ? '等于' : '不等于') + '目标值 ' + args.value + '。', 'compare');
        if (match) {
          result = { found: true, id: current.id, position };
          yield snapshot('return position;', '找到第一个匹配节点 ' + current.id + '，位置为 ' + position + '，停止查找。', 'done', true);
          return;
        }
        pointers.p = current.next;
        yield snapshot('p = p->next;', pointers.p ? '不匹配，沿 next 移动到 ' + pointers.p + '。' : '到达 nullptr，后面没有节点。');
        position++;
        yield snapshot('++position;', '位置计数增加 1，当前计数为 ' + position + '。');
      }
      result = { found: false, id: null, position: null };
      yield snapshot('return -1;', '未找到值 ' + args.value + (model.length ? '；已检查全部节点。' : '：链表为空。'), 'done', true);
      return;
    }

    if (operation === 'insert' || operation === 'delete') {
      const guard = operation === 'insert' ? 'if (position < 1 || position > n + 1 || n >= 12 || value < -99 || value > 99) return false;' : 'if (position < 1 || position > n) return false;';
      yield snapshot(guard, '边界检查通过，位置 ' + args.position + ' 合法。', 'compare');
      yield snapshot('Node* prev = nullptr;', '先将 prev 设为 nullptr；位置 1 的操作不需要前驱。');
      yield snapshot('if (position > 1) {', args.position > 1 ? '目标位置不是表头，需要沿 next 寻找前驱。' : '目标是第 1 个位置，直接处理 head。', 'compare');
      if (args.position > 1) {
        pointers.prev = model.head;
        yield snapshot('prev = head;', 'prev 从 head 开始，当前位于第 1 个节点。');
        for (let position = 1; position < args.position - 1; position++) {
          yield snapshot('for (int i = 1; i < position - 1; ++i) {', '前驱应位于第 ' + (args.position - 1) + ' 个节点，继续前进。', 'compare');
          visitedIds.add(pointers.prev);
          pointers.prev = model.nodes[pointers.prev].next;
          yield snapshot('prev = prev->next;', '沿 next 移动，prev 现在位于第 ' + (position + 1) + ' 个节点 ' + pointers.prev + '。');
        }
        yield snapshot('for (int i = 1; i < position - 1; ++i) {', 'prev 当前指向第 ' + (args.position - 1) + ' 个节点，已经找到前驱。', 'compare');
      }

      if (operation === 'insert') {
        const id = 'N' + model.nextId++;
        pointers.newNode = id;
        model.nodes[id] = { id, val: args.value, next: null };
        yield snapshot('Node* newNode = new Node{value, nullptr};', '创建节点 ' + id + '，暂放在主链表旁边，next 初始为 nullptr。', 'allocate');
        yield snapshot('if (prev == nullptr) {', pointers.prev ? '存在前驱，先让新节点接住前驱原来的后继。' : '没有前驱，执行头插。', 'compare');
        // 必须先保存原来的后继；若先改前驱，可能丢失后半段甚至形成自环。
        if (pointers.prev === null) {
          model.nodes[id].next = model.head;
          yield snapshot('newNode->next = head;', '先让新节点接住原来的 head，保留原链表入口。', 'link');
          model.head = id;
          yield snapshot('head = newNode;', '再将 head 指向新节点；新节点成为表头。', 'link');
        } else {
          model.nodes[id].next = model.nodes[pointers.prev].next;
          yield snapshot('newNode->next = prev->next;', '先让新节点接住原来的后继，避免断开后找不到后半段链表。', 'link');
          model.nodes[pointers.prev].next = id;
          yield snapshot('prev->next = newNode;', '再让 prev 的 next 指向新节点，两段链表由新节点接通。', 'link');
        }
        model.length++;
        yield snapshot('++n;', '节点已接入，链表长度增加为 ' + model.length + '。');
        yield snapshot('return true;', '在位置 ' + args.position + ' 插入 ' + args.value + ' 完成，整理节点布局。', 'done', true);
      } else {
        pointers.target = pointers.prev === null ? model.head : model.nodes[pointers.prev].next;
        const target = pointers.target;
        yield snapshot('Node* target = prev == nullptr ? head : prev->next;', 'target 指向待删除节点 ' + target + '（值 ' + model.nodes[target].val + '）。');
        yield snapshot('if (prev == nullptr) {', pointers.prev ? '存在前驱，通过修改 prev->next 绕过 target。' : '删除头节点，需要移动 head。', 'compare');
        const bypassLine = pointers.prev === null ? 'head = target->next;' : 'prev->next = target->next;';
        // target 保留待删节点，先接回后半段再模拟 delete，不能先释放再读 next。
        if (pointers.prev === null) model.head = model.nodes[target].next;
        else model.nodes[pointers.prev].next = model.nodes[target].next;
        yield snapshot(bypassLine, pointers.prev ? '现在让 prev 跳过 target，直接连接 target 后面的节点。' : 'head 改为原头节点的后继，绕过 target。', 'link');
        yield snapshot(bypassLine, 'target 已脱离主链表，但仍由 target 指针保存，尚未释放。', 'detach');
        delete model.nodes[target];
        // delete 不会自动置空局部指针。保留其 ID 但明确标记悬空，渲染不能再画有效箭头。
        releasedPointers.target = target;
        visitedIds.delete(target);
        yield snapshot('delete target;', '模拟 C++ delete：释放节点 ' + target + '；delete 不会自动置空 target，它现在是悬空指针，不能再访问。此处不是 JavaScript 手动释放内存。', 'release');
        pointers.target = null;
        delete releasedPointers.target;
        yield snapshot('target = nullptr;', '将 target 置为 nullptr，后续不再访问已经删除的节点。');
        model.length--;
        yield snapshot('--n;', '链表长度减少为 ' + model.length + '。');
        yield snapshot('return true;', '删除第 ' + args.position + ' 个节点完成' + (model.head ? '。' : '，链表现在为空。'), 'done', true);
      }
      return;
    }

    yield snapshot('Node* prev = nullptr;', 'prev 初始为 nullptr，表示已反转部分为空。');
    pointers.curr = model.head;
    yield snapshot('Node* curr = head;', pointers.curr ? 'curr 从原来的 head 开始处理节点。' : '空链表中 curr = nullptr，不需要进入循环。');
    yield snapshot('Node* next = nullptr;', 'next 初始为 nullptr；进入循环后用于暂存后继。');
    while (pointers.curr !== null) {
      yield snapshot('while (curr != nullptr) {', 'curr 指向 ' + pointers.curr + '，开始这一轮反转。', 'compare');
      // 先保存后继，随后 curr->next 的改向才不会使剩余节点失去入口。
      pointers.next = model.nodes[pointers.curr].next;
      yield snapshot('next = curr->next;', pointers.next ? '先用 next 保存后继 ' + pointers.next + '，保住尚未处理部分的入口。' : '当前节点原来是尾节点，保存的后继为 nullptr。');
      model.nodes[pointers.curr].next = pointers.prev;
      reversedIds.add(pointers.curr);
      yield snapshot('curr->next = prev;', '将 ' + pointers.curr + ' 的 next 改为 ' + (pointers.prev || 'nullptr') + '，箭头方向改变；后半段仍由 next 保存。', 'link');
      pointers.prev = pointers.curr;
      yield snapshot('prev = curr;', 'prev 前进到 ' + pointers.prev + '，成为已反转部分的头。');
      pointers.curr = pointers.next;
      yield snapshot('curr = next;', pointers.curr ? 'curr 沿保存的 next 前进到 ' + pointers.curr + '，继续处理剩余节点。' : 'curr 到达 nullptr，所有节点已经完成改向。');
    }
    model.head = pointers.prev;
    yield snapshot('head = prev;', model.head ? '最后让 head 指向新的表头 ' + model.head + '。' : 'head 仍为 nullptr，空链表反转完成。', 'link');
    yield snapshot('return;', '反转完成，节点编号和数值保持不变，整理为新的阅读顺序。', 'done', true);
  }

  return { MAX_NODES, NODE_DEFINITION, CODES, parseValues, createList, cloneList, reachableIds, validateOperation, operationSteps };
});
