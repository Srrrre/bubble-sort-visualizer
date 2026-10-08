'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../binary-tree-core.js');

const OPERATIONS = ['preorder', 'inorder', 'postorder', 'levelorder'];
const DFS = OPERATIONS.slice(0, 3);

function run(model, operation) {
  const before = Core.cloneTree(model);
  const events = [...Core.traversalSteps(model, operation)];
  assert.deepEqual(model, before, '遍历不能修改输入树');
  const final = events.at(-1);
  assert.equal(final.type, 'done');
  assert.equal(final.done, true);
  assert.equal(final.line, 0, '结束后没有正在执行的代码');
  assert.equal(final.nodeId, null);
  assert.deepEqual(final.stack, []);
  assert.deepEqual(final.queue, []);
  assert.deepEqual(final.pathIds, []);
  assert.equal(new Set(final.visitedIds).size, model.count);
  assert.equal(new Set(final.completedIds).size, model.count);
  for (const event of events) {
    assert.ok(Object.isFrozen(event));
    for (const key of ['stack', 'queue', 'visitedIds', 'completedIds', 'pathIds']) {
      assert.ok(Object.isFrozen(event[key]), key + ' 必须独立冻结');
      event[key].filter(value => typeof value === 'object' && value !== null).forEach(value => assert.ok(Object.isFrozen(value)));
    }
    if (event.activeEdge) assert.ok(Object.isFrozen(event.activeEdge));
    assert.equal(event.done, event.type === 'done');
    assert.ok(event.line >= 0 && event.line <= Core.CODES[operation].lines.length);
    if (!event.done) assert.ok(event.line > 0);
    assert.ok(event.message.length > 0);
  }
  return { events, final, values: final.visitedIds.map(id => model.nodes[id].val) };
}

test('按实际父节点的队列解析稀疏层序，保留稳定 ID 和树深度', () => {
  const model = Core.parseTree('[1, null, 2, 3]');
  assert.deepEqual(model, {
    root: 'T1', count: 3, depth: 3,
    nodes: {
      T1: { id: 'T1', val: 1, left: null, right: 'T2' },
      T2: { id: 'T2', val: 2, left: 'T3', right: null },
      T3: { id: 'T3', val: 3, left: null, right: null }
    }
  });
  assert.deepEqual(Core.parseTree('[]'), { root: null, count: 0, depth: 0, nodes: {} });
  assert.deepEqual(Core.parseTree('[ null ]'), Core.createTree([]));
  assert.equal(Core.parseTree('[1, null, null]').count, 1);
});

test('节点值支持边界、重复、负数和负零，克隆不共享节点', () => {
  const model = Core.parseTree('[0,-99,99,-0,0]');
  assert.equal(model.count, 5);
  assert.equal(model.depth, 3);
  assert.equal(Object.is(model.nodes.T4.val, -0), true);
  const clone = Core.cloneTree(model);
  assert.deepEqual(clone, model);
  clone.nodes.T1.val = 12;
  clone.nodes.T2.right = null;
  assert.equal(model.nodes.T1.val, 0);
  assert.equal(model.nodes.T2.right, 'T5');
});

test('拒绝不合法词法、无法解释的剩余 token 和非数值类型', () => {
  for (const text of [
    '', '  ', ',', '1,2,3', 'null', '[,1]', '[1,]', '[1,,2]', '[1，2]', '[1 2]', '[1', '1]', '[[1]]',
    '[1.0]', '[1.5]', '[1e1]', '[0x10]', '[NaN]', '[Infinity]', '[true]', '["1"]', '[undefined]',
    '[100]', '[-100]', '[9999999999999999999999]', '[null,1]', '[null,null]',
    '[1,null,null,2]', '[1,null,null,null]', '[1;2]', '[1][2]'
  ]) assert.throws(() => Core.parseTree(text), Error, text);
  for (const tokens of [null, {}, '1', [true], ['1'], [undefined], [NaN], [Infinity], [1.1], [100], [-100], [null, null], [1, null, null, null]]) {
    assert.throws(() => Core.createTree(tokens), Error, String(tokens));
  }
  assert.throws(() => Core.parseTree(null));
});

test('15 个实际节点可用，null 不占额度，超限拒绝', () => {
  const full = Core.createTree(Array.from({ length: 15 }, (_, index) => index));
  assert.equal(full.count, 15);
  assert.equal(full.depth, 4);
  const chain = [1];
  for (let i = 2; i <= 15; i++) chain.push(null, i);
  const sparse = Core.createTree(chain);
  assert.equal(sparse.count, 15);
  assert.equal(sparse.depth, 15);
  assert.throws(() => Core.createTree(Array(16).fill(1)), /15/);
  assert.throws(() => Core.parseTree('[' + Array(16).fill(1).join(',') + ']'), /15/);
  for (const operation of OPERATIONS) assert.equal(run(sparse, operation).values.length, 15);
});

const FIXTURES = [
  { name: '默认树', input: '[1,2,3,4,5,null,6]', expected: [[1,2,4,5,3,6], [4,2,5,1,3,6], [4,5,2,6,3,1], [1,2,3,4,5,6]] },
  { name: '空树', input: '[]', expected: [[], [], [], []] },
  { name: '单节点', input: '[7]', expected: [[7], [7], [7], [7]] },
  { name: '左链', input: '[1,2,null,3,null,4]', expected: [[1,2,3,4], [4,3,2,1], [4,3,2,1], [1,2,3,4]] },
  { name: '右链', input: '[1,null,2,null,3,null,4]', expected: [[1,2,3,4], [1,2,3,4], [4,3,2,1], [1,2,3,4]] },
  { name: '不平衡树', input: '[1,2,3,null,4,5,null,6]', expected: [[1,2,4,6,3,5], [2,6,4,1,5,3], [6,4,2,5,3,1], [1,2,3,4,5,6]] },
  { name: '重复负数零', input: '[0,-2,0,-2,3]', expected: [[0,-2,-2,3,0], [-2,-2,3,0,0], [-2,3,-2,0,0], [0,-2,0,-2,3]] },
  { name: '稀疏树', input: '[1,null,2,3]', expected: [[1,2,3], [1,3,2], [3,2,1], [1,2,3]] }
];

for (const fixture of FIXTURES) {
  test(fixture.name + '的四种遍历结果正确且快照不可修改', () => {
    const model = Core.parseTree(fixture.input);
    OPERATIONS.forEach((operation, index) => assert.deepEqual(run(model, operation).values, fixture.expected[index]));
  });
}

for (const operation of DFS) {
  test(operation + '每次进入和返回仅改变一个栈帧，当前函数严格等于栈顶', () => {
    for (const fixture of FIXTURES) {
      const model = Core.parseTree(fixture.input);
      const { events } = run(model, operation);
      const frameIds = new Set();
      let previousStack = [];
      let previousVisited = [];
      let previousCompleted = [];
      events.forEach((event, index) => {
        assert.equal(event.level, null);
        assert.deepEqual(event.queue, []);
        assert.equal(event.nodeId, event.stack.at(-1)?.nodeId ?? null);
        assert.deepEqual(event.pathIds, event.stack.map(frame => frame.nodeId).filter(id => id !== null));
        assert.deepEqual(event.visitedIds.slice(0, previousVisited.length), previousVisited);
        assert.deepEqual(event.completedIds.slice(0, previousCompleted.length), previousCompleted);
        if (event.type === 'visit') {
          assert.equal(event.visitedIds.length, previousVisited.length + 1);
          assert.equal(event.visitedIds.at(-1), event.nodeId);
          assert.equal(event.stack.at(-1).phase, 'visiting');
          assert.match(Core.CODES[operation].lines[event.line - 1], /visit\(root\)/);
        } else assert.deepEqual(event.visitedIds, previousVisited, '仅 visit 步骤才写入访问结果');
        if (event.type === 'enter') {
          assert.equal(event.stack.length, previousStack.length + 1);
          assert.deepEqual(event.stack.slice(0, -1).map(frame => frame.id), previousStack.map(frame => frame.id));
          const frame = event.stack.at(-1);
          assert.ok(!frameIds.has(frame.id), '空调用也拥有新的栈帧 ID');
          frameIds.add(frame.id);
          if (event.stack.length === 1) {
            assert.equal(frame.nodeId, model.root);
            assert.equal(frame.parentId, null);
            assert.equal(frame.side, null);
          } else {
            const parent = event.stack.at(-2);
            assert.equal(frame.parentId, parent.nodeId);
            assert.equal(frame.nodeId, model.nodes[parent.nodeId][frame.side]);
            assert.equal(parent.phase, 'waiting-' + frame.side);
            assert.equal(events[index - 1].type, 'call-' + frame.side);
          }
          assert.match(Core.CODES[operation].lines[event.line - 1], /^void /);
          assert.equal(events[index + 1].type, 'guard');
        } else if (event.type === 'resume' || event.type === 'done') {
          assert.equal(event.stack.length, previousStack.length - 1);
          assert.deepEqual(event.stack.map(frame => frame.id), previousStack.slice(0, -1).map(frame => frame.id));
          assert.equal(events[index - 1].type, 'return-ready');
        } else {
          assert.deepEqual(event.stack.map(frame => frame.id), previousStack.map(frame => frame.id));
        }
        if (event.type === 'return-ready') {
          assert.equal(event.stack.at(-1).phase, 'returning');
          const line = Core.CODES[operation].lines[event.line - 1].trim();
          assert.equal(line, event.nodeId === null ? 'return;' : '}');
          if (event.nodeId !== null) {
            assert.equal(event.completedIds.at(-1), event.nodeId);
            assert.equal(event.completedIds.length, previousCompleted.length + 1);
            assert.ok(event.visitedIds.includes(event.nodeId));
          } else assert.deepEqual(event.completedIds, previousCompleted);
        } else assert.deepEqual(event.completedIds, previousCompleted);
        previousStack = event.stack;
        previousVisited = event.visitedIds;
        previousCompleted = event.completedIds;
      });
      assert.equal(events.filter(event => event.type === 'enter').length, model.count * 2 + 1);
      assert.equal(events.filter(event => event.type === 'enter' && event.nodeId === null).length, model.count + 1);
      assert.equal(events.filter(event => event.type === 'visit').length, model.count);
    }
  });

  test(operation + '子调用返回先恢复父调用行，随后才执行下一条语句', () => {
    const model = Core.parseTree(Core.DEFAULT_INPUT);
    const { events } = run(model, operation);
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event.type !== 'resume') continue;
      assert.match(event.message, /返回/, '恢复父帧时应明确解释子调用已经返回');
      const returned = events[i - 1].stack.at(-1);
      assert.deepEqual(event.activeEdge, { from: event.nodeId, to: returned.nodeId, side: returned.side, direction: 'return' });
      assert.ok(Core.CODES[operation].lines[event.line - 1].includes(operation + '(root->' + returned.side + ')'));
      const nextType = returned.side === 'left'
        ? (operation === 'inorder' ? 'visit' : 'call-right')
        : (operation === 'postorder' ? 'visit' : 'return-ready');
      const nextPhase = nextType === 'visit' ? 'ready-visit' : nextType === 'call-right' ? 'ready-right' : 'returning';
      assert.equal(event.stack.at(-1).phase, nextPhase);
      assert.equal(events[i + 1].type, nextType);
    }
    for (const event of events.filter(item => item.type.startsWith('call-'))) {
      const side = event.type === 'call-left' ? 'left' : 'right';
      assert.equal(event.stack.at(-1).phase, 'waiting-' + side);
      assert.deepEqual(event.activeEdge, { from: event.nodeId, to: model.nodes[event.nodeId][side], side, direction: 'call' });
    }
  });
}

test('中序到达最左节点之前不访问根，后序左右子树完成后才访问根', () => {
  const model = Core.parseTree(Core.DEFAULT_INPUT);
  const inorder = run(model, 'inorder').events;
  const firstVisit = inorder.findIndex(event => event.type === 'visit');
  assert.equal(inorder[firstVisit].nodeId, 'T4');
  assert.deepEqual(inorder.slice(0, firstVisit).flatMap(event => event.visitedIds), []);
  assert.equal(inorder[firstVisit - 1].type, 'resume');
  assert.equal(inorder[firstVisit - 2].nodeId, null);
  const postorder = run(model, 'postorder').events;
  const rootVisit = postorder.find(event => event.type === 'visit' && event.nodeId === 'T1');
  assert.deepEqual(rootVisit.visitedIds, ['T4', 'T5', 'T2', 'T6', 'T3', 'T1']);
  assert.deepEqual(new Set(rootVisit.completedIds), new Set(['T2', 'T3', 'T4', 'T5', 'T6']));
});

test('BFS 独立展示入队、取队首、出队和访问，FIFO 且先左后右', () => {
  for (const fixture of FIXTURES) {
    const model = Core.parseTree(fixture.input);
    const { events } = run(model, 'levelorder');
    const pending = [];
    const enqueued = [];
    const dequeued = [];
    let visited = [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      assert.deepEqual(event.stack, []);
      assert.deepEqual(event.pathIds, []);
      if (event.type.startsWith('enqueue-')) {
        const item = event.queue.at(-1);
        assert.ok(item.nodeId !== null);
        assert.ok(!enqueued.includes(item.nodeId));
        pending.push(item);
        enqueued.push(item.nodeId);
        assert.match(Core.CODES.levelorder.lines[event.line - 1], /q\.push/);
        if (event.type === 'enqueue-root') {
          assert.deepEqual(item, { nodeId: model.root, level: 1 });
        } else {
          const side = event.type === 'enqueue-left' ? 'left' : 'right';
          assert.equal(events[i - 1].type, 'check-' + side);
          assert.equal(item.nodeId, model.nodes[event.nodeId][side]);
          assert.equal(item.level, event.level + 1);
        }
      } else if (event.type === 'peek') {
        assert.equal(event.nodeId, pending[0].nodeId);
        assert.equal(event.level, pending[0].level);
        assert.equal(events[i + 1].type, 'dequeue');
        assert.match(Core.CODES.levelorder.lines[event.line - 1], /q\.front/);
      } else if (event.type === 'dequeue') {
        assert.equal(event.nodeId, pending.shift().nodeId);
        dequeued.push(event.nodeId);
        assert.equal(events[i + 1].type, 'visit');
        assert.match(Core.CODES.levelorder.lines[event.line - 1], /q\.pop/);
      }
      assert.deepEqual(event.queue, pending, '只有入队、出队事件能改变队列');
      if (event.type === 'visit') {
        assert.equal(events[i - 1].type, 'dequeue');
        visited = [...visited, event.nodeId];
      }
      assert.deepEqual(event.visitedIds, visited);
    }
    assert.deepEqual(enqueued, dequeued);
    assert.deepEqual(dequeued, Object.keys(model.nodes));
    for (const id of dequeued) {
      const checks = events.filter(event => event.nodeId === id && ['check-left', 'check-right'].includes(event.type));
      assert.deepEqual(checks.map(event => event.type), ['check-left', 'check-right']);
    }
  }
});

test('生成后续步骤不会修改旧快照，调用方不能修改栈帧和队列项目', () => {
  const model = Core.parseTree(Core.DEFAULT_INPUT);
  const dfs = Core.traversalSteps(model, 'inorder');
  const first = dfs.next().value;
  const saved = JSON.stringify(first);
  assert.throws(() => { first.stack[0].phase = 'broken'; }, TypeError);
  assert.throws(() => { first.visitedIds.push('T1'); }, TypeError);
  [...dfs];
  assert.equal(JSON.stringify(first), saved);
  const queued = run(model, 'levelorder').events.find(event => event.type === 'enqueue-root');
  assert.throws(() => { queued.queue[0].level = 99; }, TypeError);
  assert.throws(() => [...Core.traversalSteps(model, 'unknown')], /遍历|操作/);
});
