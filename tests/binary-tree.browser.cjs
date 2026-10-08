"use strict";

// 可选的 Edge 浏览器验收：网站本身不依赖 Playwright 或 Node.js。
// 预期结果来自手工推导；测试只读页面 DOM，不访问应用内部状态。
// PLAYWRIGHT_MODULE 可指向另行安装的 Playwright，随后运行本文件。
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const projectRoot = path.resolve(__dirname, "..");
const pageURL = pathToFileURL(path.join(projectRoot, "index.html")).href;
const previewRoot = path.resolve(projectRoot, "..");
const tests = [];
const test = (name, body) => tests.push({ name, body });
const status = (page) => page.locator("#bt-status").getAttribute("data-status");
let browser;

async function openPage({ width = 1280, clock = true } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.setDefaultTimeout(5000);
  page.acceptanceErrors = [];
  page.on("pageerror", (error) => page.acceptanceErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") page.acceptanceErrors.push(`console: ${message.text()}`);
  });
  await page.route(/^https?:/, (route) => {
    page.acceptanceErrors.push(`Unexpected network request: ${route.request().url()}`);
    return route.abort();
  });
  if (clock) {
    const time = new Date("2026-01-01T00:00:00Z");
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
  }
  await page.goto(pageURL + "#binary-tree");
  assert.equal(await page.locator("#binary-tree-view").isVisible(), true);
  return page;
}

async function closePage(page) {
  assert.deepEqual(page.acceptanceErrors, [], "No console errors, uncaught errors or online dependencies");
  await page.close();
}

async function snapshot(page) {
  return page.evaluate(() => {
    const text = (selector) => document.querySelector(selector).textContent.trim();
    const nodes = [...document.querySelectorAll("#bt-canvas .bt-node")].map((node) => {
      const matrix = node.transform.baseVal.consolidate().matrix;
      return {
        id: node.dataset.nodeId, value: Number(node.dataset.value),
        state: node.dataset.state, states: node.dataset.states,
        text: node.textContent.replace(/\s+/g, " ").trim(), x: matrix.e, y: matrix.f
      };
    });
    return {
      nodes,
      // nullptr 调用的临时虚线不是树中实际节点之间的结构边。
      edges: [...document.querySelectorAll("#bt-canvas .bt-edge[data-from][data-to]")].map((edge) => ({ from: edge.dataset.from, to: edge.dataset.to })),
      stack: [...document.querySelectorAll("#bt-stack .bt-frame")].map((frame) => ({
        id: frame.dataset.frameId, nodeId: frame.dataset.nodeId, depth: Number(frame.dataset.depth),
        active: frame.classList.contains("active"), text: frame.textContent.replace(/\s+/g, " ").trim()
      })),
      queue: [...document.querySelectorAll("#bt-queue .bt-queue-item")].map((node) => ({ id: node.dataset.nodeId, level: Number(node.dataset.level) })),
      result: [...document.querySelectorAll("#bt-result .bt-result-item")].map((node) => ({ id: node.dataset.nodeId, value: Number(node.dataset.value) })),
      lines: [...document.querySelectorAll("#bt-code .bt-code-line.active")].map((line) => ({ number: Number(line.dataset.line), text: line.textContent.trim() })),
      count: Number(text("#bt-count")), treeDepth: Number(text("#bt-tree-depth")),
      depth: Number(text("#bt-recursion-depth")), current: text("#bt-current"), level: text("#bt-level"),
      step: Number(text("#bt-step-count")), description: text("#bt-description"), currentCode: text("#bt-current-code")
    };
  });
}

function graph(frame) {
  return {
    nodes: frame.nodes.map(({ id, value, x, y }) => ({ id, value, x, y })),
    edges: frame.edges, count: frame.count, depth: frame.treeDepth
  };
}

function assertTree(frame) {
  const ids = new Set(frame.nodes.map((node) => node.id));
  assert.equal(ids.size, frame.nodes.length, "Node IDs stay unique even for repeated values");
  assert.equal(frame.count, frame.nodes.length);
  assert.equal(frame.edges.length, Math.max(frame.nodes.length - 1, 0), "Every non-root node has exactly one visible parent edge");
  const children = new Set();
  for (const node of frame.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.text.includes(String(node.value)), "The SVG visibly labels each value");
    assert.ok(node.text.includes(node.id), "The SVG visibly labels each stable ID");
  }
  for (const edge of frame.edges) {
    assert.ok(ids.has(edge.from) && ids.has(edge.to), "Edges reference actual nodes");
    assert.ok(!children.has(edge.to), "A node cannot have two parents");
    children.add(edge.to);
    const parent = frame.nodes.find((node) => node.id === edge.from);
    const child = frame.nodes.find((node) => node.id === edge.to);
    assert.ok(child.y > parent.y, "Children are rendered below their parents");
    assert.notEqual(child.x, parent.x, "Left and right child sides are visually distinct");
  }
  for (let i = 0; i < frame.nodes.length; i++) {
    for (let j = i + 1; j < frame.nodes.length; j++) {
      const a = frame.nodes[i], b = frame.nodes[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 60, "Node circles do not overlap");
    }
  }
}

async function create(page, input) {
  await page.locator("#bt-input").fill(Array.isArray(input) ? JSON.stringify(input) : input);
  await page.locator("#bt-create").click();
  assert.equal(await status(page), "idle");
  assert.equal(await page.locator("#bt-error").isVisible(), false);
  const frame = await snapshot(page);
  assertTree(frame);
  assert.equal(frame.step, 0);
  return frame;
}

async function speed(page, value) {
  await page.locator("#bt-speed").fill(String(value));
  assert.match(await page.locator("#bt-speed-output").textContent(), new RegExp(String(1500 - value)));
}

async function step(page) {
  const before = await snapshot(page);
  // DOM click exercises the same button handler without waiting for visual
  // scrolling between each of the many individual algorithm frames.
  await page.locator("#bt-step").evaluate((button) => button.click());
  const after = await snapshot(page);
  assert.equal(after.step, before.step + 1, "One click executes exactly one teaching step");
  assert.match(after.description, /[\u4e00-\u9fff]/, "Every event has a Chinese explanation");
  assert.ok(after.lines.length <= 1, "Exactly one C++ statement is active at a time");
  if (await status(page) !== "completed") assert.equal(after.lines.length, 1, "Every running frame points to the current statement");
  if (after.lines.length) assert.equal(after.currentCode, after.lines[0].text, "Current-code summary and reference highlight stay synchronized");
  assertTree(after);
  return after;
}

async function finishSteps(page) {
  const frames = [];
  for (let i = 0; i < 400 && await status(page) !== "completed"; i++) frames.push(await step(page));
  assert.equal(await status(page), "completed", "Traversal terminates in a bounded number of steps");
  return frames;
}

async function finishAuto(page) {
  for (let i = 0; i < 400 && await status(page) !== "completed"; i++) await page.clock.runFor(1000);
  assert.equal(await status(page), "completed");
  return snapshot(page);
}

function assertResult(frame, values, ids) {
  assert.deepEqual(frame.result.map((node) => node.value), values);
  if (ids) assert.deepEqual(frame.result.map((node) => node.id), ids);
  assert.equal(new Set(frame.result.map((node) => node.id)).size, values.length, "Each node is visited once");
  assert.equal(frame.result.length, frame.nodes.length, "No tree node is lost or visited twice");
  assert.deepEqual([...frame.result.map((node) => node.value)].sort((a, b) => a - b),
    [...frame.nodes.map((node) => node.value)].sort((a, b) => a - b), "Traversal preserves the multiset");
  assert.equal(frame.stack.length, 0);
  assert.equal(frame.queue.length, 0);
  assert.equal(frame.lines.length, 0, "Completion does not pretend a statement is still executing");
  assert.ok(frame.nodes.every((node) => node.states.split(" ").includes("completed")), "All actual nodes receive their completed state");
}

test("direct file URL initializes the default sparse tree and three independent modules", async () => {
  const page = await openPage();
  const frame = await snapshot(page);
  assertTree(frame);
  assert.deepEqual(frame.nodes.map((node) => node.value).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.equal(frame.treeDepth, 3);
  assert.equal(frame.count, 6);
  const byValue = (value) => frame.nodes.find((node) => node.value === value);
  for (const [parent, child, side] of [[1, 2, "left"], [1, 3, "right"], [2, 4, "left"], [2, 5, "right"], [3, 6, "right"]]) {
    assert.ok(frame.edges.some((edge) => edge.from === byValue(parent).id && edge.to === byValue(child).id));
    assert.ok(side === "left" ? byValue(child).x < byValue(parent).x : byValue(child).x > byValue(parent).x);
  }
  await page.locator("#nav-list").click();
  assert.equal(await page.locator("#linked-list-view").isVisible(), true);
  assert.equal(await page.locator("#binary-tree-view").isVisible(), false);
  await page.locator("#nav-bubble").click();
  assert.deepEqual((await page.locator(".bar-value").allTextContents()).map(Number), [5, 3, 8, 2, 6]);
  await page.locator("#nav-tree").click();
  assert.deepEqual(graph(await snapshot(page)), graph(frame));
  assert.equal(await page.locator("#nav-tree").getAttribute("aria-pressed"), "true");
  await closePage(page);
});

const defaults = {
  preorder: { values: [1, 2, 4, 5, 3, 6], ids: ["T1", "T2", "T4", "T5", "T3", "T6"] },
  inorder: { values: [4, 2, 5, 1, 3, 6], ids: ["T4", "T2", "T5", "T1", "T3", "T6"] },
  postorder: { values: [4, 5, 2, 6, 3, 1], ids: ["T4", "T5", "T2", "T6", "T3", "T1"] },
  levelorder: { values: [1, 2, 3, 4, 5, 6], ids: ["T1", "T2", "T3", "T4", "T5", "T6"] }
};

for (const [operation, expected] of Object.entries(defaults)) test(`${operation}: default result, identity, actual visit timing and execution state`, async () => {
  const page = await openPage();
  await page.locator("#bt-operation").selectOption(operation);
  const original = graph(await snapshot(page));
  const frames = await finishSteps(page);
  assertResult(frames.at(-1), expected.values, expected.ids);
  for (const frame of frames) assert.deepEqual(graph(frame), original, "Traversals do not mutate the tree");
  let previousResult = 0;
  for (const frame of frames) {
    assert.deepEqual(frame.nodes.filter((node) => node.states.split(" ").includes("visited")).map((node) => node.id).sort(),
      frame.result.map((node) => node.id).sort(), "Visited styling reflects actual visits, not function entry");
    assert.ok(frame.result.length === previousResult || frame.result.length === previousResult + 1);
    if (frame.result.length > previousResult) {
      assert.match(frame.lines[0].text, /visit|push_back|cout/, "Appending output coincides with the C++ visit statement");
      assert.ok(frame.current.includes(frame.result.at(-1).id));
    }
    previousResult = frame.result.length;
  }
  assert.ok(frames.some((frame) => frame.result.length === 0 && frame.current.includes("T1")), "Entering the root is distinct from visiting it");
  if (operation !== "levelorder") {
    let sawNull = false, sawReturn = false;
    const entered = new Set();
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      assert.equal(frame.depth, frame.stack.length, "Displayed depth includes every active call, including nullptr");
      assert.equal(frame.stack.filter((entry) => entry.active).length, frame.stack.length ? 1 : 0);
      if (frame.stack.length) {
        assert.equal(frame.stack[0].active, true, "Top frame is the currently executing call");
        const top = frame.stack[0];
        assert.ok(frame.current.includes(top.nodeId === "null" ? "nullptr" : top.nodeId));
        assert.deepEqual(frame.nodes.filter((node) => node.states.split(" ").includes("current")).map((node) => node.id),
          top.nodeId === "null" ? [] : [top.nodeId], "Current SVG node and active frame agree");
        assert.deepEqual(frame.nodes.filter((node) => node.states.split(" ").includes("path")).map((node) => node.id).sort(),
          frame.stack.filter((entry) => entry.nodeId !== "null").map((entry) => entry.nodeId).sort(), "Path styling follows all current recursive calls");
        if (top.nodeId === "null") sawNull = true;
        if (!entered.has(top.id)) {
          entered.add(top.id);
          assert.match(frame.lines[0].text, /void\s+\w+|TreeNode\s*\*/, "A fresh frame begins at function entry");
        }
        for (let index = 1; index < frame.stack.length; index++) {
          const child = frame.stack[index - 1], parent = frame.stack[index];
          assert.equal(parent.depth, child.depth - 1);
          if (child.nodeId !== "null") assert.ok(frame.edges.some((edge) => edge.from === parent.nodeId && edge.to === child.nodeId), "Stack follows actual parent-child calls");
        }
      }
      const previous = frames[i - 1];
      if (previous && previous.stack.length > frame.stack.length && frame.stack.length) {
        sawReturn = true;
        assert.equal(previous.stack.length, frame.stack.length + 1, "A return pops precisely one frame");
        assert.equal(frame.stack[0].id, previous.stack[1].id, "Returning resumes the same parent call");
        assert.match(frame.lines[0].text, /->\s*(left|right)/, "Parent resumes at the completed child call site");
        assert.match(frame.description, /返回/);
      }
    }
    assert.ok(sawNull && sawReturn, "Trace includes null base cases and actual parent resumption");
  }
  assert.equal(await page.locator("#bt-start").isDisabled(), false);
  await closePage(page);
});

test("BFS queue shows root enqueue, FIFO dequeue and separate visits; left child enters before right", async () => {
  const page = await openPage();
  await page.locator("#bt-operation").selectOption("levelorder");
  const frames = await finishSteps(page);
  let previous = { queue: [], result: [] };
  const enqueued = [], dequeued = [];
  for (const frame of frames) {
    assert.equal(frame.stack.length, 0, "BFS never displays a recursion stack");
    const before = previous.queue.map((node) => node.id), after = frame.queue.map((node) => node.id);
    if (after.length === before.length + 1) {
      assert.deepEqual(after.slice(0, -1), before, "Enqueue appends at the tail");
      enqueued.push(after.at(-1));
      assert.match(frame.lines[0].text, /\.push\(/);
      assert.equal(frame.result.length, previous.result.length, "Enqueue does not visit");
    } else if (after.length === before.length - 1) {
      assert.deepEqual(after, before.slice(1), "Dequeue removes only the head");
      dequeued.push(before[0]);
      assert.match(frame.lines[0].text, /\.pop\(/);
      assert.equal(frame.result.length, previous.result.length, "Dequeue does not visit");
    } else assert.deepEqual(after, before, "Non-queue statements preserve FIFO contents");
    assert.ok(frame.queue.every((node) => Number.isInteger(node.level) && node.level >= 1));
    previous = frame;
  }
  assert.deepEqual(enqueued, defaults.levelorder.ids);
  assert.deepEqual(dequeued, defaults.levelorder.ids);
  assertResult(frames.at(-1), defaults.levelorder.values, defaults.levelorder.ids);
  await closePage(page);
});

test("queue construction handles sparse tokens, negative numbers, zero and duplicate identities", async () => {
  const page = await openPage();
  const sparse = await create(page, [1, null, 2, 3]);
  const root = sparse.nodes.find((node) => node.id === "T1");
  const second = sparse.nodes.find((node) => node.id === "T2");
  const third = sparse.nodes.find((node) => node.id === "T3");
  assert.ok(second.x > root.x && third.x < second.x);
  assert.deepEqual(sparse.edges, [{ from: "T1", to: "T2" }, { from: "T2", to: "T3" }]);
  assert.equal(sparse.treeDepth, 3);
  const valid = await create(page, [-1, 0, -1, null, 0]);
  assert.deepEqual(valid.nodes.map((node) => node.value).sort((a, b) => a - b), [-1, -1, 0, 0]);
  await page.locator("#bt-operation").selectOption("preorder");
  await speed(page, 1400);
  await page.locator("#bt-start").click();
  assertResult(await finishAuto(page), [-1, 0, 0, -1], ["T1", "T2", "T4", "T3"]);
  await page.locator("#bt-default").click();
  assert.equal((await snapshot(page)).count, 6);
  assert.equal((await snapshot(page)).treeDepth, 3);
  await closePage(page);
});

test("invalid text, decimals, bounds, excess tokens and sixteenth node preserve the valid tree", async () => {
  const page = await openPage();
  const baseline = graph(await snapshot(page));
  for (const input of ["", " ", "1,2", "[1,2", "[1,a]", "[1,2.5]", "[1,1.0]", "[1,2e1]", "[1,100]", "[-100]", "[1,,2]", "[1,]", "[null,1]", "[1,null,null,2]", "[1,null,null,null]", JSON.stringify(Array(16).fill(1))]) {
    await page.locator("#bt-input").fill(input);
    await page.locator("#bt-create").click();
    assert.equal(await page.locator("#bt-error").isVisible(), true, `Reject ${JSON.stringify(input)}`);
    assert.match(await page.locator("#bt-error").textContent(), /[\u4e00-\u9fff]/);
    assert.deepEqual(graph(await snapshot(page)), baseline, "Rejected input cannot replace the valid graph");
  }
  await closePage(page);
});

for (const fixture of [
  { label: "empty", input: [], count: 0, depth: 0, expected: [] },
  { label: "null root", input: [null], count: 0, depth: 0, expected: [] },
  { label: "single", input: [0], count: 1, depth: 1, expected: [0] },
  { label: "left chain", input: [1, 2, null, 3, null, 4], count: 4, depth: 4, expected: [1, 2, 3, 4] },
  { label: "right chain", input: [1, null, 2, null, 3, null, 4], count: 4, depth: 4, expected: [1, 2, 3, 4] },
  { label: "15 nodes", input: Array.from({ length: 15 }, (_, i) => i + 1), count: 15, depth: 4, expected: Array.from({ length: 15 }, (_, i) => i + 1) }
]) test(`${fixture.label}: valid rendering and automatic traversal termination`, async () => {
  const page = await openPage();
  const before = await create(page, fixture.input);
  assert.equal(before.count, fixture.count);
  assert.equal(before.treeDepth, fixture.depth);
  await speed(page, 1400);
  const operations = fixture.count <= 1 ? Object.keys(defaults) : ["levelorder"];
  for (const operation of operations) {
    await page.locator("#bt-operation").selectOption(operation);
    await page.locator("#bt-start").click();
    assertResult(await finishAuto(page), fixture.expected);
  }
  await closePage(page);
});

test("pause freezes every teaching view; repeated controls preserve one timer; manual step resumes from same frame", async () => {
  const page = await openPage();
  const baseline = graph(await snapshot(page));
  await speed(page, 1000);
  await page.locator("#bt-start").click();
  assert.equal(await status(page), "running");
  for (const selector of ["#bt-input", "#bt-create", "#bt-default", "#bt-start", "#bt-step"]) assert.equal(await page.locator(selector).isDisabled(), true);
  assert.equal(await page.locator("#bt-operation").isDisabled(), false, "Traversal switching is always available");
  const first = await snapshot(page);
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) document.querySelector("#bt-start").dispatchEvent(new MouseEvent("click"));
    document.querySelector("#bt-step").dispatchEvent(new MouseEvent("click"));
    document.querySelector("#bt-default").dispatchEvent(new MouseEvent("click"));
    document.querySelector("#bt-create-form").dispatchEvent(new Event("submit", { cancelable: true }));
  });
  await page.clock.runFor(499);
  assert.deepEqual(await snapshot(page), first);
  await page.clock.runFor(1);
  assert.equal((await snapshot(page)).step, first.step + 1, "Exactly one callback runs at the next interval");
  await page.locator("#bt-pause").click();
  assert.equal(await status(page), "paused");
  const frozen = await snapshot(page);
  await page.clock.runFor(10000);
  assert.deepEqual(await snapshot(page), frozen, "Pause freezes graph, stack, queue, result, code and explanation");
  for (const selector of ["#bt-input", "#bt-create", "#bt-default"]) assert.equal(await page.locator(selector).isDisabled(), true);
  const stepped = await step(page);
  await page.clock.runFor(2000);
  assert.deepEqual(await snapshot(page), stepped, "Single step remains paused");
  await page.locator("#bt-pause").click();
  await speed(page, 1400);
  const final = await finishAuto(page);
  assertResult(final, defaults.preorder.values, defaults.preorder.ids);
  assert.deepEqual(graph(final), baseline);
  await page.locator("#bt-start").click();
  const restarted = await snapshot(page);
  assert.equal(restarted.result.length, 0);
  assert.equal(restarted.step, 1);
  assertResult(await finishAuto(page), defaults.preorder.values, defaults.preorder.ids);
  await closePage(page);
});

test("speed endpoints and changes affect subsequent steps without losing progress", async () => {
  const page = await openPage();
  assert.equal(await page.locator("#bt-speed").getAttribute("min"), "0");
  assert.equal(await page.locator("#bt-speed").getAttribute("max"), "1400");
  await speed(page, 0);
  await page.locator("#bt-start").click();
  const first = (await snapshot(page)).step;
  await page.clock.runFor(1499);
  assert.equal((await snapshot(page)).step, first);
  await page.clock.runFor(1);
  assert.equal((await snapshot(page)).step, first + 1);
  await speed(page, 1400);
  await page.clock.runFor(1500); // Allow the already pending interval to finish.
  const changed = (await snapshot(page)).step;
  assert.ok(changed > first);
  await page.clock.runFor(99);
  assert.equal((await snapshot(page)).step, changed);
  await page.clock.runFor(1);
  assert.equal((await snapshot(page)).step, changed + 1);
  await closePage(page);
});

for (const cancel of ["running reset", "paused reset", "running operation", "paused operation", "navigation"]) test(`${cancel}: clear transient state and cancel every old callback`, async () => {
  const page = await openPage();
  const baseline = graph(await snapshot(page));
  await speed(page, 1400);
  await page.locator("#bt-start").click();
  await page.clock.runFor(1800);
  const progressing = await snapshot(page);
  assert.ok(progressing.step > 1 && progressing.stack.length > 0 && progressing.result.length > 0);
  if (cancel.startsWith("paused")) await page.locator("#bt-pause").click();
  if (cancel.endsWith("reset")) await page.locator("#bt-reset").click();
  else if (cancel.endsWith("operation")) await page.locator("#bt-operation").selectOption("levelorder");
  else await page.locator("#nav-list").click();
  const cancelled = await snapshot(page);
  assert.equal(await status(page), "idle");
  assert.equal(cancelled.step, 0);
  assert.deepEqual(cancelled.result, []);
  assert.deepEqual(cancelled.stack, []);
  assert.deepEqual(cancelled.queue, []);
  assert.deepEqual(graph(cancelled), baseline);
  await page.clock.runFor(10000);
  assert.deepEqual(await snapshot(page), cancelled);
  if (cancel === "navigation") await page.locator("#nav-tree").click();
  await page.locator("#bt-start").click();
  const expected = cancel.endsWith("operation") ? defaults.levelorder : defaults.preorder;
  assertResult(await finishAuto(page), expected.values, expected.ids);
  await closePage(page);
});

test("real Edge timers also freeze on pause and cancel after reset", async () => {
  const page = await openPage({ clock: false });
  await speed(page, 1400);
  await page.locator("#bt-start").click();
  await page.waitForFunction(() => Number(document.querySelector("#bt-step-count").textContent) >= 5);
  await page.locator("#bt-pause").click();
  const paused = await snapshot(page);
  await page.waitForTimeout(350);
  assert.deepEqual(await snapshot(page), paused);
  await page.locator("#bt-pause").click();
  await page.locator("#bt-reset").click();
  const reset = await snapshot(page);
  await page.waitForTimeout(350);
  assert.deepEqual(await snapshot(page), reset);
  await closePage(page);
});

test("15-level chain exposes 16 active calls including nullptr and scrolls both tree and stack locally", async () => {
  const page = await openPage();
  const tokens = [1];
  for (let value = 2; value <= 15; value++) tokens.push(value, null);
  await create(page, tokens);
  await page.locator("#bt-operation").selectOption("postorder");
  await speed(page, 1400);
  await page.locator("#bt-start").click();
  let frame;
  for (let i = 0; i < 300; i++) {
    frame = await snapshot(page);
    if (frame.stack.length === 16) break;
    await page.clock.runFor(100);
  }
  assert.equal(frame.treeDepth, 15);
  assert.equal(frame.depth, 16);
  assert.equal(frame.stack[0].nodeId, "null");
  assert.equal(frame.result.length, 0, "Postorder has not visited an ancestor before the deepest base case");
  await page.locator("#bt-pause").click();
  const layout = await page.evaluate(() => ["bt-scroll", "bt-stack"].map((id) => {
    const element = document.getElementById(id);
    const before = element.scrollTop;
    element.scrollTop = 200;
    return { id, before, after: element.scrollTop, height: element.clientHeight, content: element.scrollHeight };
  }));
  for (const area of layout) assert.ok(area.content > area.height && area.after > area.before, `${area.id} remains vertically scrollable`);
  await page.locator("#bt-pause").click();
  assertResult(await finishAuto(page), Array.from({ length: 15 }, (_, i) => 15 - i));
  await closePage(page);
});

for (const width of [1280, 390, 320]) test(`${width}px layout: readable SVG, local scrolling and no document overflow`, async () => {
  const page = await openPage({ width });
  if (width === 1280) {
    await page.screenshot({ path: path.join(previewRoot, "tree-desktop.png"), fullPage: true });
    for (let i = 0; i < 50; i++) {
      const frame = await step(page);
      if (frame.stack.length >= 4) break;
    }
    assert.ok((await snapshot(page)).stack.length >= 4, "Screenshot shows actual nested calls including nullptr");
    await page.screenshot({ path: path.join(previewRoot, "tree-stack.png"), fullPage: true });
    await page.locator("#bt-reset").click();
  }
  await create(page, Array.from({ length: 15 }, (_, i) => i + 1));
  const layout = await page.evaluate(() => {
    const scroll = document.querySelector("#bt-scroll");
    scroll.scrollLeft = 1000;
    const moved = scroll.scrollLeft;
    scroll.scrollLeft = 0;
    return {
      document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
      width: scroll.clientWidth, content: scroll.scrollWidth, moved,
      nodes: [...document.querySelectorAll("#bt-canvas .bt-node")].map((node) => node.getBoundingClientRect().width)
    };
  });
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `No page-wide overflow: ${JSON.stringify(layout)}`);
  assert.ok(layout.content > layout.width && layout.moved > 0, "Wide trees scroll locally");
  assert.ok(layout.nodes.every((size) => size >= 50), "Tree nodes retain readable size");
  if (width === 390) await page.screenshot({ path: path.join(previewRoot, "tree-mobile.png"), fullPage: true });
  await closePage(page);
});

(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  console.log(`Browser: Microsoft Edge ${browser.version()}; offline file URL`);
  let failures = 0;
  for (const { name, body } of tests) {
    const started = Date.now();
    try {
      await body();
      console.log(`PASS ${name} (${Date.now() - started} ms)`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}\n${error.stack}`);
      for (const context of browser.contexts()) await context.close();
    }
  }
  await browser.close();
  console.log(`${tests.length - failures}/${tests.length} binary-tree browser acceptance checks passed.`);
  process.exitCode = failures ? 1 : 0;
})().catch(async (error) => {
  console.error(error.stack);
  if (browser) await browser.close();
  process.exitCode = 1;
});
