(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BinaryTreeCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const MAX_NODES = 15;
  const DEFAULT_INPUT = '[1,2,3,4,5,null,6]';
  const NODE_DEFINITION = 'struct TreeNode {\n    int val;\n    TreeNode* left;\n    TreeNode* right;\n};\n// visit(root) 表示输出 root->val，不改变树的结构。';
  const ORDERS = {
    preorder: ['visit', 'left', 'right'],
    inorder: ['left', 'visit', 'right'],
    postorder: ['left', 'right', 'visit']
  };

  function depthFirstCode(operation, title, principle) {
    return {
      title,
      lines: [
        'void ' + operation + '(TreeNode* root) {',
        '    if (root == nullptr) {',
        '        return;',
        '    }',
        ...ORDERS[operation].map(action => action === 'visit' ? '    visit(root);' : '    ' + operation + '(root->' + action + ');'),
        '}'
      ],
      principle,
      complexity: '时间 O(n)，递归辅助空间 O(h)。n 为节点数，h 为树高；临时 nullptr 调用也占一个栈帧。记录访问结果额外需要 O(n)；若额外保存全部历史快照，最坏需要 O(n²) 空间。'
    };
  }

  const CODES = {
    preorder: depthFirstCode('preorder', '前序遍历（Preorder）', '根 → 左 → 右。进入函数后，确认 root 非空，先访问当前节点，再递归处理左右子树；进入函数与访问节点是两个步骤。'),
    inorder: depthFirstCode('inorder', '中序遍历（Inorder）', '左 → 根 → 右。进入函数后先递归左子树，左调用返回后才访问当前节点。因此默认树先访问最左侧的 4，而不是根节点 1。'),
    postorder: depthFirstCode('postorder', '后序遍历（Postorder）', '左 → 右 → 根。左右子树调用都返回后，才访问当前节点；因此默认树的根节点 1 最后被访问。'),
    levelorder: {
      title: '层序遍历（Level Order）',
      lines: [
        'void levelOrder(TreeNode* root) {',
        '    if (root == nullptr) {',
        '        return;',
        '    }',
        '    queue<TreeNode*> q;',
        '    q.push(root);',
        '    while (!q.empty()) {',
        '        TreeNode* curr = q.front();',
        '        q.pop();',
        '        visit(curr);',
        '        if (curr->left != nullptr) {',
        '            q.push(curr->left);',
        '        }',
        '        if (curr->right != nullptr) {',
        '            q.push(curr->right);',
        '        }',
        '    }',
        '}'
      ],
      principle: '从上到下、每层从左到右。根先入队，每轮取出队首并访问，再依次将存在的左、右孩子加入队尾。队列先进先出，nullptr 不入队。visit(curr) 表示输出 curr->val。',
      complexity: '时间 O(n)，队列辅助空间 O(w)。n 为节点数，w 为树的最大宽度；跨层时队列长度可略大于单层宽度，仍为 O(w)。记录访问结果额外需要 O(n)；若额外保存全部历史快照，最坏需要 O(n²) 空间。'
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

  function checkValue(value, index) {
    if (value === null) return;
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new Error('第 ' + (index + 1) + ' 项必须是整数或 null。');
    }
    if (value < -99 || value > 99) throw new Error('第 ' + (index + 1) + ' 项超出范围：节点值必须在 -99～99 之间。');
  }

  function parseTree(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('请输入层序序列，例如 [1,2,3]；创建空树请填写 []。');
    let source = text.trim();
    const startsBracket = source.startsWith('[');
    const endsBracket = source.endsWith(']');
    if (!startsBracket || !endsBracket) throw new Error('层序序列需要成对的方括号，例如 [1,2,3]。');
    source = source.slice(1, -1).trim();
    if (/[\[\]]/.test(source)) throw new Error('只支持一层方括号包围的层序序列。');
    if (!source) return createTree([]);
    const tokens = source.split(',').map((part, index) => {
      const token = part.trim();
      if (!token) throw new Error('第 ' + (index + 1) + ' 项为空，请移除开头、结尾或重复的逗号。');
      if (token === 'null') return null;
      // 先检查词法再转数值，避免 1.0、1e1 被 Number 静默接受。
      if (!/^[+-]?\d+$/.test(token)) throw new Error('第 ' + (index + 1) + ' 项“' + token + '”无效；请填写整数或 null，并使用英文逗号分隔。');
      return Number(token);
    });
    return createTree(tokens);
  }

  function createTree(tokens) {
    if (!Array.isArray(tokens)) throw new Error('创建二叉树需要整数或 null 组成的层序数组。');
    for (let i = 0; i < tokens.length; i++) checkValue(tokens[i], i);
    if (tokens.filter(value => value !== null).length > MAX_NODES) throw new Error('二叉树最多包含 15 个实际节点，null 不计入节点数。');
    const model = { nodes: {}, root: null, count: 0, depth: 0 };
    if (!tokens.length) return model;
    if (tokens[0] === null) {
      if (tokens.length > 1) throw new Error('根节点为 null，后面不能再有节点或多余的 null。');
      return model;
    }

    function addNode(value, depth) {
      const id = 'T' + (++model.count);
      model.nodes[id] = { id, val: value, left: null, right: null };
      model.depth = Math.max(model.depth, depth);
      return id;
    }

    model.root = addNode(tokens[0], 1);
    const parents = [{ nodeId: model.root, depth: 1 }];
    let nextParent = 0;
    let nextToken = 1;
    // 队列中只有真实父节点；稀疏树不能使用 2*i+1、2*i+2 的完全树下标。
    while (nextToken < tokens.length) {
      if (nextParent >= parents.length) throw new Error('第 ' + (nextToken + 1) + ' 项无法分配：所有实际父节点都已处理，存在多余节点或 null。');
      const parent = parents[nextParent++];
      for (const side of ['left', 'right']) {
        if (nextToken >= tokens.length) break;
        const value = tokens[nextToken++];
        if (value === null) continue;
        const id = addNode(value, parent.depth + 1);
        model.nodes[parent.nodeId][side] = id;
        parents.push({ nodeId: id, depth: parent.depth + 1 });
      }
    }
    return model;
  }

  function cloneTree(model) {
    const nodes = {};
    for (const [id, node] of Object.entries(model.nodes)) nodes[id] = { ...node };
    return { nodes, root: model.root, count: model.count, depth: model.depth };
  }

  function* traversalSteps(original, operation) {
    if (!Object.prototype.hasOwnProperty.call(CODES, operation)) throw new Error('未知的二叉树遍历操作。');
    const model = cloneTree(original);
    const stack = [];
    const queue = [];
    const visitedIds = [];
    const completedIds = [];
    let nextFrame = 1;
    let current = null;
    let level = null;

    function snapshot(type, line, message, activeEdge = null) {
      // 每步复制所有变化中的容器，再深度冻结：继续播放不会改写历史步骤。
      return freezeDeep({
        type,
        nodeId: operation === 'levelorder' ? current : (stack.at(-1)?.nodeId ?? null),
        stack: stack.map(frame => ({ ...frame })),
        queue: queue.map(item => ({ ...item })),
        visitedIds: [...visitedIds],
        completedIds: [...completedIds],
        pathIds: stack.filter(frame => frame.nodeId !== null).map(frame => frame.nodeId),
        activeEdge: activeEdge ? { ...activeEdge } : null,
        line,
        message,
        done: type === 'done',
        level: operation === 'levelorder' ? level : null
      });
    }

    function nodeLabel(id) {
      return id === null ? 'nullptr' : model.nodes[id].val + '（' + id + '）';
    }

    if (operation === 'levelorder') {
      yield snapshot('enter', 1, '进入层序遍历函数，接下来先检查根节点。');
      yield snapshot('guard', 2, model.root === null ? '根节点为 nullptr，不能入队，将直接返回。' : '根节点存在，可以创建队列并让根入队。');
      if (model.root === null) {
        yield snapshot('return-ready', 3, '空树没有可访问的节点，执行 return。');
      } else {
        queue.push({ nodeId: model.root, level: 1 });
        level = 1;
        yield snapshot('enqueue-root', 6, '创建空队列后，将根节点 ' + nodeLabel(model.root) + ' 加入队尾；它属于第 1 层。');
        while (true) {
          current = null;
          level = null;
          yield snapshot('check-queue', 7, queue.length ? '队列不为空，继续处理队首节点。' : '队列已空，所有节点均已处理，结束循环。');
          if (!queue.length) break;
          const front = queue[0];
          current = front.nodeId;
          level = front.level;
          yield snapshot('peek', 8, '读取队首 ' + nodeLabel(current) + '，curr 指向它；q.front() 此时还没有移除节点。');
          queue.shift();
          yield snapshot('dequeue', 9, '执行 q.pop()，从队头移除 ' + nodeLabel(current) + '；curr 仍保存该节点，尚未访问。');
          visitedIds.push(current);
          yield snapshot('visit', 10, '访问第 ' + level + ' 层的节点 ' + nodeLabel(current) + '，将值加入遍历结果。');
          for (const side of ['left', 'right']) {
            const child = model.nodes[current][side];
            const sideText = side === 'left' ? '左' : '右';
            const checkLine = side === 'left' ? 11 : 14;
            yield snapshot('check-' + side, checkLine, child === null ? '检查' + sideText + '孩子：它为 nullptr，不入队。' : '检查' + sideText + '孩子：' + nodeLabel(child) + ' 存在，接下来加入队尾。');
            if (child !== null) {
              queue.push({ nodeId: child, level: level + 1 });
              yield snapshot('enqueue-' + side, checkLine + 1, '将' + sideText + '孩子 ' + nodeLabel(child) + ' 加入队尾，等待处理第 ' + (level + 1) + ' 层。', { from: current, to: child, side, direction: 'call' });
            }
          }
          completedIds.push(current);
          yield snapshot('complete', 17, '节点 ' + nodeLabel(current) + ' 的访问与左右孩子检查都已完成，回到循环条件。');
        }
      }
      current = null;
      level = null;
      yield snapshot('done', 0, '层序遍历结束，队列为空；共访问 ' + visitedIds.length + ' 个节点。');
      return;
    }

    const actions = ORDERS[operation];
    function actionLine(action) { return 5 + actions.indexOf(action); }
    function nextPhase(actionIndex) {
      const next = actions[actionIndex + 1];
      return next ? 'ready-' + next : 'returning';
    }

    function* walk(nodeId, parentId = null, side = null) {
      const frame = { id: 'F' + nextFrame++, nodeId, parentId, side, phase: 'entering' };
      stack.push(frame);
      const callEdge = parentId === null ? null : { from: parentId, to: nodeId, side, direction: 'call' };
      yield snapshot('enter', 1, nodeId === null ? '进入 ' + operation + '(nullptr)，空指针调用也会产生一个临时栈帧。' : '进入节点 ' + nodeLabel(nodeId) + ' 的递归函数，压入新栈帧；进入函数还不等于访问节点。', callEdge);
      frame.phase = 'checking';
      yield snapshot('guard', 2, nodeId === null ? '检查 root == nullptr：条件成立，下一步执行 return。' : '检查 root == nullptr：条件不成立，按当前遍历顺序继续。');

      if (nodeId === null) {
        frame.phase = 'returning';
        yield snapshot('return-ready', 3, '当前 root 为 nullptr，执行 return；这个临时栈帧即将弹出，不记录访问结果。');
      } else {
        for (let index = 0; index < actions.length; index++) {
          const action = actions[index];
          if (action === 'visit') {
            frame.phase = 'visiting';
            visitedIds.push(nodeId);
            const reason = operation === 'inorder' ? '左子树调用已返回，现在' : operation === 'postorder' ? '左右子树调用都已返回，现在' : '先';
            yield snapshot('visit', actionLine(action), reason + '访问节点 ' + nodeLabel(nodeId) + '，将值加入遍历结果。');
          } else {
            const child = model.nodes[nodeId][action];
            const sideText = action === 'left' ? '左' : '右';
            frame.phase = 'waiting-' + action;
            yield snapshot('call-' + action, actionLine(action), '节点 ' + nodeLabel(nodeId) + ' 调用' + sideText + '子树 ' + nodeLabel(child) + '，当前栈帧等待该调用返回。', { from: nodeId, to: child, side: action, direction: 'call' });
            // 真正的递归 generator：子调用完整结束后，才可能继续当前函数。
            yield* walk(child, nodeId, action);
          }
        }
        frame.phase = 'returning';
        completedIds.push(nodeId);
        yield snapshot('return-ready', 8, '节点 ' + nodeLabel(nodeId) + ' 的访问及左右子树调用均已完成，执行到函数末尾，即将弹出当前栈帧。');
      }

      // 返回的瞬间先恢复父帧，并高亮刚结束的那条调用语句，不能提前执行下一句。
      stack.pop();
      const parent = stack.at(-1);
      if (parent) {
        parent.phase = nextPhase(actions.indexOf(side));
        const sideText = side === 'left' ? '左' : '右';
        const next = parent.phase === 'ready-visit' ? '下一步访问当前节点' : parent.phase === 'ready-right' ? '下一步递归右子树' : '下一步从当前函数返回';
        yield snapshot('resume', actionLine(side), nodeId === null ? '空的' + sideText + '子树调用已返回，恢复节点 ' + nodeLabel(parent.nodeId) + ' 的栈帧；' + next + '。' : sideText + '子树 ' + nodeLabel(nodeId) + ' 的调用已返回，恢复节点 ' + nodeLabel(parent.nodeId) + ' 的栈帧；' + next + '。', { from: parent.nodeId, to: nodeId, side, direction: 'return' });
      }
    }

    yield* walk(model.root);
    yield snapshot('done', 0, '递归遍历结束，根调用也已返回，调用栈为空；共访问 ' + visitedIds.length + ' 个节点。');
  }

  return { MAX_NODES, DEFAULT_INPUT, NODE_DEFINITION, CODES, parseTree, createTree, cloneTree, traversalSteps };
});
