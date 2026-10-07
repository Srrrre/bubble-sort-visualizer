'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../linked-list-core.js');

function run(model, operation, args) {
  const events = [...Core.operationSteps(model, operation, args)];
  assert.ok(events.length > 0);
  for (const event of events) {
    assert.ok(Object.isFrozen(event));
    assert.ok(Object.isFrozen(event.model));
    assert.ok(Object.isFrozen(event.model.nodes));
    assert.ok(Object.isFrozen(event.pointers));
    assert.ok(Object.isFrozen(event.visited));
    assert.ok(Number.isInteger(event.line) && event.line > 0);
    assert.ok(event.line <= Core.CODES[operation].lines.length);
    for (const [name, id] of Object.entries(event.pointers)) {
      const released = event.releasedPointers || {};
      if (Object.hasOwn(released, name)) {
        assert.equal(released[name], id, '悬空标记应保留被释放节点的 ID');
        assert.equal(event.model.nodes[id], undefined, '只有节点已释放的局部指针才可标记为悬空');
      } else {
        assert.ok(id === null || event.model.nodes[id], '有效指针必须指向存活节点');
      }
    }
    assert.ok(event.model.head === null || event.model.nodes[event.model.head], 'head 始终不能悬空');
    for (const node of Object.values(event.model.nodes)) {
      assert.ok(Object.isFrozen(node));
      assert.ok(node.next === null || event.model.nodes[node.next], 'next 不应悬空');
    }
  }
  const final = events.at(-1);
  assert.equal(final.done, true);
  assert.equal(final.type, 'done');
  const reachable = Core.reachableIds(final.model);
  assert.equal(reachable.length, final.model.length);
  assert.equal(Object.keys(final.model.nodes).length, final.model.length);
  return { events, model: final.model, final };
}

function values(model) {
  return Core.reachableIds(model).map(id => model.nodes[id].val);
}

test('输入支持中英文逗号、空白、重复值、0、负数', () => {
  assert.deepEqual(Core.parseValues('10, 20，0 -99\n99\t10'), [10, 20, 0, -99, 99, 10]);
  assert.deepEqual(values(Core.createList([0, -1, -1])), [0, -1, -1]);
});

test('错误输入不会被静默忽略或转换', () => {
  for (const input of ['', '  ', ',', '10,x', '1.5', '1e1', '0x10', '100', '-100', '1;2', '1'.repeat(100), Array(13).fill(1).join(',')]) {
    assert.throws(() => Core.parseValues(input), Error, input);
  }
  for (const input of [[100], [1.1], ['10'], Array(13).fill(1)]) {
    assert.throws(() => Core.createList(input));
  }
});

test('克隆完整保留暂不可达节点且不会共享可修改数据', () => {
  const model = Core.createList([10, 20]);
  model.nodes.N1.next = null;
  const cloned = Core.cloneList(model);
  assert.deepEqual(cloned, model);
  cloned.nodes.N2.val = 99;
  assert.equal(model.nodes.N2.val, 20);
  assert.deepEqual(Core.reachableIds(model), ['N1']);
});

test('沿 next 遍历会拒绝环与悬空引用', () => {
  const cyclic = Core.createList([1, 2]);
  cyclic.nodes.N2.next = 'N1';
  assert.throws(() => Core.reachableIds(cyclic), /环/);
  const dangling = Core.createList([1]);
  dangling.nodes.N1.next = 'N8';
  assert.throws(() => Core.reachableIds(dangling), /悬空|不存在/);
});

test('遍历每次只沿 next 移动一格并保留访问值', () => {
  const original = Core.createList([10, 20, 30]);
  const { events, final } = run(original, 'traverse');
  assert.deepEqual(events.filter(e => e.type === 'visit').map(e => e.pointers.p), ['N1', 'N2', 'N3']);
  assert.deepEqual(final.visited, [10, 20, 30]);
  assert.equal(final.pointers.p, null);
  assert.deepEqual(values(original), [10, 20, 30]);
  assert.deepEqual(run(Core.createList([]), 'traverse').final.visited, []);
});

test('查找首尾和不存在值，重复值只返回第一次匹配', () => {
  const model = Core.createList([0, -2, 0, 9]);
  for (const [value, id, position] of [[0, 'N1', 1], [9, 'N4', 4], [-2, 'N2', 2], [7, null, null]]) {
    const { final } = run(model, 'search', { value });
    assert.deepEqual(final.result, { found: id !== null, id, position });
  }
  assert.deepEqual(run(model, 'search', { value: 0 }).final.visited, [0]);
  assert.equal(run(Core.createList([]), 'search', { value: 0 }).final.result.found, false);
});

test('插入位置使用一基计数，覆盖头、中间、尾与空表', () => {
  for (const [initial, position, expected] of [
    [[10, 20], 1, [15, 10, 20]],
    [[10, 20], 2, [10, 15, 20]],
    [[10, 20], 3, [10, 20, 15]],
    [[], 1, [15]]
  ]) {
    const model = Core.createList(initial);
    const { model: final } = run(model, 'insert', { position, value: 15 });
    assert.deepEqual(values(final), expected);
    for (const id of Object.keys(model.nodes)) assert.equal(final.nodes[id].val, model.nodes[id].val);
  }
});

test('插入先创建旁置节点、接住后继，再改前驱或 head', () => {
  for (const position of [1, 2, 3]) {
    const model = Core.createList([10, 20]);
    const { events } = run(model, 'insert', { position, value: 15 });
    const allocation = events.findIndex(e => e.type === 'allocate');
    const links = events.filter(e => e.type === 'link');
    assert.ok(allocation >= 0);
    assert.equal(events[allocation].model.nodes.N3.next, null);
    assert.deepEqual(Core.reachableIds(events[allocation].model), ['N1', 'N2']);
    assert.equal(links.length, 2);
    assert.equal(links[0].model.nodes.N3.next, position === 1 ? 'N1' : position === 2 ? 'N2' : null);
    assert.equal(links[0].model.head, 'N1');
    assert.equal(links[0].model.nodes.N1.next, 'N2');
    assert.equal(links[1].model.head, position === 1 ? 'N3' : 'N1');
    assert.deepEqual(values(model), [10, 20]);
  }
});

test('删除头、中、尾与唯一节点，链表结构始终无悬空引用', () => {
  for (const [initial, position, expected, removed] of [
    [[10, 20, 30], 1, [20, 30], 'N1'],
    [[10, 20, 30], 2, [10, 30], 'N2'],
    [[10, 20, 30], 3, [10, 20], 'N3'],
    [[10], 1, [], 'N1']
  ]) {
    const initialModel = Core.createList(initial);
    const { model, events } = run(initialModel, 'delete', { position });
    assert.deepEqual(values(model), expected);
    assert.equal(model.nodes[removed], undefined);
    const bypass = events.findIndex(e => e.type === 'link');
    const detach = events.findIndex(e => e.type === 'detach');
    const release = events.findIndex(e => e.type === 'release');
    assert.ok(bypass < detach && detach < release);
    assert.ok(events[detach].model.nodes[removed]);
    assert.ok(!Core.reachableIds(events[detach].model).includes(removed));
    assert.equal(events[release].model.nodes[removed], undefined);
    assert.equal(events.at(-1).pointers.target, null);
    assert.deepEqual(values(initialModel), initial);
  }
});

test('delete 仅释放节点，局部 target 下一步显式置空后才清除悬空标记', () => {
  const { events } = run(Core.createList([10, 20, 30]), 'delete', { position: 2 });
  const releaseIndex = events.findIndex(event => event.type === 'release');
  const release = events[releaseIndex];
  assert.equal(release.model.nodes.N2, undefined);
  assert.equal(release.pointers.target, 'N2', 'delete 不会自动把 target 置为 nullptr');
  assert.deepEqual(release.releasedPointers, { target: 'N2' });
  assert.ok(Object.isFrozen(release.releasedPointers));
  const cleared = events[releaseIndex + 1];
  assert.equal(cleared.pointers.target, null);
  assert.deepEqual(cleared.releasedPointers, {});
  for (const event of events) assert.ok(Object.isFrozen(event.releasedPointers));
});

test('参数校验拒绝越界、非法整数与满容量插入', () => {
  const model = Core.createList([10, 20]);
  for (const position of [0, -1, 4, 1.2, '', 'x']) {
    assert.throws(() => Core.validateOperation(model, 'insert', { position, value: 1 }));
  }
  for (const position of [0, 3, '1.2']) assert.throws(() => Core.validateOperation(model, 'delete', { position }));
  for (const value of [100, -100, 1.2, '', '1e1', 'x']) assert.throws(() => Core.validateOperation(model, 'search', { value }));
  assert.throws(() => Core.validateOperation(Core.createList([]), 'delete', { position: 1 }));
  assert.throws(() => Core.validateOperation(Core.createList(Array(12).fill(0)), 'insert', { position: 1, value: 0 }));
  assert.throws(() => Core.validateOperation(model, 'unknown'));
  assert.deepEqual(Core.validateOperation(model, 'insert', { position: '2', value: '-9' }), { position: 2, value: -9 });
});

test('反转逐步保存 next 再修改箭头，全部存活节点始终保留', () => {
  const model = Core.createList([10, 20, 30]);
  const { events, model: reversed } = run(model, 'reverse');
  const linkEvents = events.filter(e => e.type === 'link' && e.pointers.curr !== null);
  assert.equal(linkEvents.length, 3);
  assert.deepEqual(linkEvents.map(e => [e.pointers.curr, e.pointers.next, e.model.nodes[e.pointers.curr].next]), [
    ['N1', 'N2', null], ['N2', 'N3', 'N1'], ['N3', null, 'N2']
  ]);
  for (const event of events) assert.deepEqual(Object.keys(event.model.nodes), ['N1', 'N2', 'N3']);
  for (const link of linkEvents) {
    const index = events.indexOf(link);
    assert.equal(events[index - 1].pointers.next, link.pointers.next);
    assert.equal(events[index - 1].model.nodes[link.pointers.curr].next, link.pointers.next);
    assert.equal(events[index + 1].pointers.prev, link.pointers.curr);
    assert.equal(events[index + 2].pointers.curr, link.pointers.next);
  }
  assert.deepEqual(Core.reachableIds(reversed), ['N3', 'N2', 'N1']);
  assert.deepEqual(Core.reachableIds(run(reversed, 'reverse').model), ['N1', 'N2', 'N3']);
  assert.deepEqual(values(model), [10, 20, 30]);
});

test('反转空表与单节点合法，快照无法修改后续或原链表', () => {
  assert.deepEqual(values(run(Core.createList([]), 'reverse').model), []);
  assert.deepEqual(values(run(Core.createList([0]), 'reverse').model), [0]);
  const model = Core.createList([10, 20]);
  const iterator = Core.operationSteps(model, 'reverse');
  const first = iterator.next().value;
  assert.throws(() => { first.model.nodes.N1.next = null; }, TypeError);
  assert.deepEqual(values(model), [10, 20]);
});

test('反转 prev 标记已反转入口，而插删 prev 仍标记位置前驱', () => {
  const model = Core.createList([10, 20, 30]);
  const { events } = run(model, 'reverse');
  for (const event of events.filter(event => event.pointers.prev !== null)) {
    assert.ok(event.roles[event.pointers.prev].includes('已反转入口'));
    assert.ok(!event.roles[event.pointers.prev].includes('前驱'));
  }
  for (const operation of ['insert', 'delete']) {
    const { events: operationEvents } = run(model, operation, { position: 2, value: 15 });
    for (const event of operationEvents.filter(event => event.pointers.prev !== null)) {
      assert.ok(event.roles[event.pointers.prev].includes('前驱'));
      assert.ok(!event.roles[event.pointers.prev].includes('已反转入口'));
    }
  }
});

test('连续插入、删除、反转保持稳定 ID、结构和长度', () => {
  let model = Core.createList([10, 20, 30]);
  model = run(model, 'insert', { position: 2, value: 15 }).model;
  assert.deepEqual(Core.reachableIds(model), ['N1', 'N4', 'N2', 'N3']);
  assert.deepEqual(values(model), [10, 15, 20, 30]);
  model = run(model, 'delete', { position: 3 }).model;
  assert.deepEqual(Core.reachableIds(model), ['N1', 'N4', 'N3']);
  assert.deepEqual(values(model), [10, 15, 30]);
  model = run(model, 'reverse').model;
  assert.deepEqual(Core.reachableIds(model), ['N3', 'N4', 'N1']);
  assert.deepEqual(values(model), [30, 15, 10]);
  model = run(model, 'insert', { position: 4, value: 40 }).model;
  assert.equal(model.nodes.N5.val, 40, '已释放 ID 不得复用');
});
