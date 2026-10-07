"use strict";

// Optional acceptance suite; the offline site has no runtime dependencies.
// Run: PLAYWRIGHT_MODULE=/path/to/playwright node tests/linked-list.browser.cjs
// A separately installed Microsoft Edge is required. Expectations below are
// hand-checked fixtures; no production algorithm is used to compute answers.
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const projectRoot = path.resolve(__dirname, "..");
const pageURL = pathToFileURL(path.join(projectRoot, "index.html")).href;
const previewRoot = path.resolve(projectRoot, "..");
const tests = [];
const test = (name, body) => tests.push({ name, body });
const status = (page) => page.locator("#ll-status").getAttribute("data-status");
let browser;

async function openPage({ width = 1280, clock = true, linked = true } = {}) {
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
  await page.goto(pageURL + (linked ? "#linked-list" : ""));
  assert.equal(await page.locator(linked ? "#linked-list-view" : "#bubble-view").isVisible(), true);
  return page;
}

async function closePage(page) {
  assert.deepEqual(page.acceptanceErrors, [], "No console errors, uncaught errors or network dependencies");
  await page.close();
}

async function snapshot(page) {
  return page.evaluate(() => {
    const text = (selector) => document.querySelector(selector).textContent.trim();
    const nodes = [...document.querySelectorAll("#ll-canvas .ll-node")].map((node) => ({
      id: node.dataset.id, val: Number(node.dataset.val), next: node.dataset.next,
      displayedValue: Number(node.querySelector(".ll-node-value").textContent),
      text: node.textContent.replace(/\s+/g, " ").trim()
    })).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    const pointers = Object.fromEntries([...document.querySelectorAll("#ll-pointers [data-pointer]")]
      .map((pointer) => [pointer.dataset.pointer, pointer.dataset.target]));
    const pointerLabels = Object.fromEntries([...document.querySelectorAll("#ll-pointers [data-pointer]")]
      .map((pointer) => [pointer.dataset.pointer, pointer.textContent.trim()]));
    return {
      nodes, pointers, pointerLabels, length: Number(text("#ll-length")),
      description: text("#ll-description"), count: Number(text("#ll-step-count")),
      visited: text("#ll-visited"), sequence: text("#ll-sequence"),
      lines: [...document.querySelectorAll("#ll-code .ll-code-line.active")]
        .map((line) => ({ number: Number(line.dataset.line), text: line.textContent.trim() })),
      edges: [...document.querySelectorAll("#ll-canvas path.ll-edge")]
        .map((edge) => ({ from: edge.dataset.from, to: edge.dataset.to, marker: edge.getAttribute("marker-end"), d: edge.getAttribute("d") }))
        .sort((a, b) => a.from.localeCompare(b.from, undefined, { numeric: true }))
    };
  });
}

function graph(frame) {
  return { head: frame.pointers.head, nodes: frame.nodes.map(({ id, val, next }) => ({ id, val, next })), length: frame.length };
}

function trace(frame) {
  const map = new Map(frame.nodes.map((node) => [node.id, node]));
  assert.equal(map.size, frame.nodes.length, "Every living node has a unique ID");
  const result = [];
  const seen = new Set();
  let cursor = frame.pointers.head;
  assert.ok(cursor !== undefined, "head remains an explicit pointer even for an empty list");
  while (cursor !== "null") {
    assert.ok(!seen.has(cursor), `Unexpected cycle at ${cursor}`);
    seen.add(cursor);
    const node = map.get(cursor);
    assert.ok(node, `Pointer references a missing node: ${cursor}`);
    result.push(node);
    cursor = node.next;
  }
  return result;
}

function assertArrows(frame) {
  assert.equal(frame.edges.length, frame.nodes.length, "Each living node has one visible next arrow, including nullptr");
  for (const node of frame.nodes) {
    assert.equal(node.val, node.displayedValue, "Displayed value matches the node value");
    assert.match(node.text, /val/);
    assert.match(node.text, /next/);
    const edges = frame.edges.filter((edge) => edge.from === node.id);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].to, node.next, `${node.id}'s drawn arrow matches its next field`);
    assert.ok(edges[0].marker && edges[0].marker.includes("url("), "next connections must have arrowheads");
    assert.ok(edges[0].d && !/NaN|undefined/.test(edges[0].d), "Arrow geometry is valid");
    assert.ok(node.next === "null" || frame.nodes.some((item) => item.id === node.next), "No next points to a freed node");
  }
  for (const [name, target] of Object.entries(frame.pointers)) {
    const live = target === "null" || frame.nodes.some((node) => node.id === target);
    // C++ delete leaves target dangling until it is explicitly cleared. The
    // tutorial may show that brief state, provided the label explains it.
    if (!live && name === "target") assert.match(frame.pointerLabels.target, /已释放|悬空/, "A dangling teaching pointer must be labeled explicitly");
    else assert.ok(live, `Pointer ${name} target ${target} exists`);
  }
}

async function assertList(page, expected, ids) {
  const frame = await snapshot(page);
  const reachable = trace(frame);
  assert.deepEqual(reachable.map((node) => node.val), expected);
  assert.equal(frame.length, expected.length, "Completed length is the actual reachable node count");
  assert.equal(frame.nodes.length, expected.length, "No unreferenced or extra node survives completion");
  if (ids) assert.deepEqual(reachable.map((node) => node.id), ids, "Surviving nodes retain their identities");
  for (const node of reachable) {
    assert.ok(frame.sequence.includes(node.id), "Final sequence includes stable IDs");
    assert.ok(frame.sequence.includes(String(node.val)), "Final sequence includes values");
  }
  assert.match(frame.sequence, /nullptr|null/);
  assertArrows(frame);
  return frame;
}

async function create(page, input) {
  if (Array.isArray(input) && input.length === 0) {
    await page.locator("#ll-clear").click();
  } else {
    await page.locator("#ll-input").fill(Array.isArray(input) ? input.join(", ") : input);
    await page.locator("#ll-create").click();
  }
  assert.equal(await status(page), "idle");
  assert.equal(await page.locator("#ll-error").isVisible(), false);
}

async function select(page, operation, { value, position } = {}) {
  await page.locator("#ll-operation").selectOption(operation);
  if (value !== undefined) await page.locator("#ll-value").fill(String(value));
  if (position !== undefined) await page.locator("#ll-position").fill(String(position));
}

async function setSpeed(page, value) {
  await page.locator("#ll-speed").fill(String(value));
  assert.match(await page.locator("#ll-speed-output").textContent(), new RegExp(String(1500 - value)));
}

async function step(page) {
  const before = await snapshot(page);
  await page.locator("#ll-step").click();
  const after = await snapshot(page);
  assert.equal(after.count, before.count + 1, "Next executes exactly one teaching step");
  assert.ok(after.lines.length > 0, "Every step highlights corresponding C++ code");
  assert.ok(after.lines.every((line) => Number.isInteger(line.number) && line.number > 0));
  assert.ok(after.description.length > 0, "Every step includes a Chinese explanation");
  assert.match(after.description, /[\u4e00-\u9fff]/);
  assertArrows(after);
  return after;
}

async function finishSteps(page) {
  const frames = [];
  for (let i = 0; i < 150 && await status(page) !== "completed"; i++) frames.push(await step(page));
  assert.equal(await status(page), "completed", "Operation terminates in a bounded number of steps");
  return frames;
}

async function finishAuto(page) {
  for (let i = 0; i < 150 && await status(page) !== "completed"; i++) await page.clock.runFor(1000);
  assert.equal(await status(page), "completed");
}

function code(frame, expression) {
  assert.match(frame.lines.map((line) => line.text).join(" "), expression, "Highlighted C++ line agrees with pointer mutation");
}

test("direct file hash and navigation preserve the default graph and bubble module", async () => {
  const page = await openPage();
  await assertList(page, [10, 20, 30, 40]);
  assert.equal(await page.locator("#bubble-view").isVisible(), false);
  await page.locator("#nav-bubble").click();
  assert.equal(await page.locator("#bubble-view").isVisible(), true);
  assert.equal(await page.locator("#linked-list-view").isVisible(), false);
  assert.deepEqual((await page.locator(".bar-value").allTextContents()).map(Number), [5, 3, 8, 2, 6]);
  await page.locator("#nav-list").click();
  await assertList(page, [10, 20, 30, 40]);
  await closePage(page);
});

test("creation accepts mixed separators, negative numbers, zero and duplicates; rejects invalid input atomically", async () => {
  const page = await openPage();
  await create(page, "-99， 0  0, 99");
  const baseline = graph(await assertList(page, [-99, 0, 0, 99]));
  for (const input of ["", " ", "1,a", "1,2.5", "-100,0", "0,100", "1,2e1", Array(13).fill(1).join(",")]) {
    await page.locator("#ll-input").fill(input);
    await page.locator("#ll-create").click();
    assert.equal(await page.locator("#ll-error").isVisible(), true, `Reject ${JSON.stringify(input)}`);
    assert.ok((await page.locator("#ll-error").textContent()).trim().length > 0);
    assert.deepEqual(graph(await snapshot(page)), baseline, "Invalid input preserves the entire valid graph");
  }
  await closePage(page);
});

test("random creates 5–8 legal nodes and clear creates head → nullptr", async () => {
  const page = await openPage();
  for (let i = 0; i < 8; i++) {
    await page.locator("#ll-random").click();
    const frame = await snapshot(page);
    const values = trace(frame).map((node) => node.val);
    assert.ok(values.length >= 5 && values.length <= 8);
    assert.ok(values.every((value) => Number.isInteger(value) && value >= -99 && value <= 99));
    await assertList(page, values);
  }
  await create(page, []);
  await assertList(page, []);
  await closePage(page);
});

test("traversal moves p through next and records every value in order", async () => {
  const page = await openPage();
  await create(page, [-2, 0, -2]);
  const ids = trace(await snapshot(page)).map((node) => node.id);
  await select(page, "traverse");
  const frames = await finishSteps(page);
  const targets = frames.map((frame) => frame.pointers.p).filter((target, index, array) => target !== undefined && target !== array[index - 1]);
  assert.deepEqual(targets, [...ids, "null"]);
  assert.deepEqual(frames.at(-1).visited.match(/-?\d+/g).map(Number), [-2, 0, -2]);
  await assertList(page, [-2, 0, -2], ids);
  await closePage(page);
});

for (const fixture of [
  { label: "head", values: [10, 20, 30], value: 10, found: 0 },
  { label: "tail", values: [10, 20, 30], value: 30, found: 2 },
  { label: "missing", values: [10, 20, 30], value: 99, found: -1 },
  { label: "first duplicate", values: [7, 2, 7], value: 7, found: 0 },
  { label: "empty", values: [], value: 4, found: -1 }
]) test(`search ${fixture.label}: stop at first match or explain absence`, async () => {
  const page = await openPage();
  await create(page, fixture.values);
  const original = graph(await snapshot(page));
  const ids = trace(await snapshot(page)).map((node) => node.id);
  await select(page, "search", { value: fixture.value });
  const frames = await finishSteps(page);
  const last = frames.at(-1);
  if (fixture.found < 0) {
    assert.match(last.description, /未找到|没有找到|不存在/);
    assert.equal(last.pointers.p, "null");
  } else {
    assert.equal(last.pointers.p, ids[fixture.found]);
    assert.match(last.description, new RegExp(String(fixture.found + 1)), "Search reports a one-based position");
    assert.ok(frames.every((frame) => frame.pointers.p !== ids[fixture.found + 1]), "Search stops at the first match");
  }
  assert.deepEqual(graph(last), original);
  await closePage(page);
});

for (const fixture of [
  { label: "head", values: [10, 20], position: 1, expected: [7, 10, 20] },
  { label: "middle", values: [10, 20], position: 2, expected: [10, 7, 20] },
  { label: "tail", values: [10, 20], position: 3, expected: [10, 20, 7] },
  { label: "empty", values: [], position: 1, expected: [7] }
]) test(`insert at ${fixture.label}: one-based position and stable original IDs`, async () => {
  const page = await openPage();
  await create(page, fixture.values);
  const old = trace(await snapshot(page));
  await select(page, "insert", { position: fixture.position, value: 7 });
  await finishSteps(page);
  const result = await assertList(page, fixture.expected);
  for (const node of old) assert.ok(result.nodes.some((item) => item.id === node.id && item.val === node.val));
  await closePage(page);
});

test("middle insertion allocates beside the chain, connects newNode.next first, then rewires prev.next", async () => {
  const page = await openPage();
  await create(page, [10, 20, 30]);
  const [first, successor] = trace(await snapshot(page));
  await select(page, "insert", { position: 2, value: 15 });
  const frames = await finishSteps(page);
  const allocated = frames.findIndex((frame) => frame.nodes.some((node) => node.val === 15));
  const newId = frames[allocated].nodes.find((node) => node.val === 15).id;
  assert.equal(frames[allocated].pointers.newNode, newId);
  assert.ok(!trace(frames[allocated]).some((node) => node.id === newId), "Candidate is initially outside the main chain");
  const connected = frames.findIndex((frame) => frame.nodes.some((node) => node.id === newId && node.next === successor.id));
  const linked = frames.findIndex((frame) => frame.nodes.some((node) => node.id === first.id && node.next === newId));
  assert.ok(allocated < connected && connected < linked, "Allocate, save successor and update predecessor are distinct ordered steps");
  assert.equal(frames[connected].nodes.find((node) => node.id === first.id).next, successor.id);
  assert.equal(frames[connected].pointers.prev, first.id);
  code(frames[connected], /newNode\s*->\s*next\s*=\s*prev\s*->\s*next/);
  code(frames[linked], /prev\s*->\s*next\s*=\s*newNode/);
  await assertList(page, [10, 15, 20, 30]);
  await closePage(page);
});

test("head insertion saves the old head before changing head; completed reset restores the prior graph", async () => {
  const page = await openPage();
  await create(page, [10, 20]);
  const baseline = graph(await snapshot(page));
  const oldHead = baseline.head;
  await select(page, "insert", { position: 1, value: 5 });
  const frames = await finishSteps(page);
  const connected = frames.findIndex((frame) => frame.nodes.some((node) => node.val === 5 && node.next === oldHead));
  const newId = frames[connected].nodes.find((node) => node.val === 5).id;
  const linked = frames.findIndex((frame) => frame.pointers.head === newId);
  assert.ok(connected >= 0 && linked > connected, "Saving the old head and updating head are separate ordered steps");
  assert.equal(frames[connected].pointers.head, oldHead);
  code(frames[connected], /newNode\s*->\s*next\s*=\s*head/);
  code(frames[linked], /head\s*=\s*newNode/);
  await assertList(page, [5, 10, 20]);
  await page.locator("#ll-reset").click();
  assert.deepEqual(graph(await snapshot(page)), baseline, "Reset after completion also restores operation-start IDs and links");
  await closePage(page);
});

for (const fixture of [
  { label: "head", values: [10, 20, 30], position: 1, expected: [20, 30], retained: [1, 2] },
  { label: "middle", values: [10, 20, 30], position: 2, expected: [10, 30], retained: [0, 2] },
  { label: "tail", values: [10, 20, 30], position: 3, expected: [10, 20], retained: [0, 1] },
  { label: "only node", values: [10], position: 1, expected: [], retained: [] }
]) test(`delete ${fixture.label}: remove only the target and preserve survivor IDs`, async () => {
  const page = await openPage();
  await create(page, fixture.values);
  const ids = trace(await snapshot(page)).map((node) => node.id);
  await select(page, "delete", { position: fixture.position });
  await finishSteps(page);
  await assertList(page, fixture.expected, fixture.retained.map((index) => ids[index]));
  await closePage(page);
});

test("middle deletion bypasses target, displays it detached, then simulates release", async () => {
  const page = await openPage();
  await create(page, [10, 20, 30]);
  const [prev, target, next] = trace(await snapshot(page));
  await select(page, "delete", { position: 2 });
  const frames = await finishSteps(page);
  const selected = frames.findIndex((frame) => frame.pointers.target === target.id);
  const bypassed = frames.findIndex((frame) => frame.nodes.find((node) => node.id === prev.id).next === next.id);
  const removed = frames.findIndex((frame) => !frame.nodes.some((node) => node.id === target.id));
  assert.ok(selected < bypassed && bypassed < removed, "Capture, bypass and release have separate frames");
  const detached = frames.slice(bypassed, removed).find((frame) => /脱离/.test(frame.description + frame.nodes.find((node) => node.id === target.id).text));
  assert.ok(detached, "The living but detached target is explained before release");
  assert.ok(!trace(frames[bypassed]).some((node) => node.id === target.id));
  code(frames[bypassed], /prev\s*->\s*next\s*=\s*target\s*->\s*next/);
  code(frames[removed], /delete\s+target/);
  await assertList(page, [10, 30], [prev.id, next.id]);
  await closePage(page);
});

test("reversal keeps all living nodes and exposes each of four pointer assignments independently", async () => {
  const page = await openPage();
  await create(page, [10, 20, 30, 40]);
  const original = trace(await snapshot(page));
  await select(page, "reverse");
  const frames = await finishSteps(page);
  let searchFrom = 0;
  for (let i = 0; i < original.length; i++) {
    const curr = original[i].id;
    const prev = i === 0 ? "null" : original[i - 1].id;
    const next = i + 1 < original.length ? original[i + 1].id : "null";
    const saved = frames.findIndex((frame, index) => index >= searchFrom && frame.pointers.curr === curr &&
      frame.pointers.next === next && frame.lines.some((line) => /next\s*=\s*curr\s*->\s*next/.test(line.text)));
    assert.ok(saved >= searchFrom, `Iteration ${i + 1} saves next while curr remains on the current node`);
    const reversed = frames[saved + 1];
    const movedPrev = frames[saved + 2];
    const movedCurr = frames[saved + 3];
    assert.equal(reversed.nodes.find((node) => node.id === curr).next, prev);
    assert.equal(reversed.pointers.next, next, "Saved next retains the unprocessed suffix");
    assert.equal(reversed.pointers.curr, curr);
    assert.equal(reversed.pointers.prev, prev);
    code(reversed, /curr\s*->\s*next\s*=\s*prev/);
    assert.equal(movedPrev.pointers.prev, curr);
    assert.equal(movedPrev.pointers.curr, curr);
    code(movedPrev, /prev\s*=\s*curr/);
    assert.equal(movedCurr.pointers.curr, next);
    code(movedCurr, /curr\s*=\s*next/);
    searchFrom = saved + 4;
  }
  for (const frame of frames) assert.deepEqual(frame.nodes.map((node) => node.id).sort(), original.map((node) => node.id).sort(), "No off-head node disappears during reversal");
  const temporary = frames.find((frame) => trace(frame).length === 1 && frame.nodes.length === 4);
  assert.ok(temporary, "At least one frame actually shows nodes unreachable from the old head");
  assert.match(temporary.sequence, /临时|过程|进行/);
  await assertList(page, [40, 30, 20, 10], original.map((node) => node.id).reverse());
  await closePage(page);
});

for (const values of [[], [7]]) test(`reverse ${values.length === 0 ? "empty" : "single-node"} list safely`, async () => {
  const page = await openPage();
  await create(page, values);
  const original = graph(await snapshot(page));
  await select(page, "reverse");
  await finishSteps(page);
  await assertList(page, values);
  assert.deepEqual(graph(await snapshot(page)), original);
  await closePage(page);
});

test("two reversals restore exact IDs, head and next relations", async () => {
  const page = await openPage();
  await create(page, [3, 0, 3, -2]);
  const original = graph(await snapshot(page));
  await select(page, "reverse");
  await finishSteps(page);
  await page.locator("#ll-start").click();
  await finishAuto(page);
  assert.deepEqual(graph(await snapshot(page)), original);
  await closePage(page);
});

test("insert → delete → reverse uses the previous result and preserves surviving identities", async () => {
  const page = await openPage();
  await create(page, [10, 20, 30]);
  const [a, removed, c] = trace(await snapshot(page));
  await select(page, "insert", { position: 2, value: 15 });
  await finishSteps(page);
  const inserted = trace(await assertList(page, [10, 15, 20, 30]))[1];
  await select(page, "delete", { position: 3 });
  await finishSteps(page);
  await assertList(page, [10, 15, 30], [a.id, inserted.id, c.id]);
  await select(page, "reverse");
  await finishSteps(page);
  const result = await assertList(page, [30, 15, 10], [c.id, inserted.id, a.id]);
  assert.ok(result.nodes.every((node) => node.id !== removed.id && node.next !== removed.id));
  await closePage(page);
});

test("illegal positions and values, empty deletion and thirteenth insertion preserve the list", async () => {
  const page = await openPage();
  for (const fixture of [
    { values: [10, 20], operation: "insert", position: 0, value: 5 },
    { values: [10, 20], operation: "insert", position: 4, value: 5 },
    { values: [10, 20], operation: "insert", position: 1.5, value: 5 },
    { values: [10, 20], operation: "insert", position: 1, value: 100 },
    { values: [10, 20], operation: "insert", position: 1, value: 2.5 },
    { values: [10, 20], operation: "delete", position: 0 },
    { values: [10, 20], operation: "delete", position: 3 },
    { values: [], operation: "delete", position: 1 },
    { values: [], operation: "insert", position: 2, value: 5 },
    { values: Array(12).fill(1), operation: "insert", position: 13, value: 5 }
  ]) {
    await create(page, fixture.values);
    const baseline = graph(await snapshot(page));
    await select(page, fixture.operation, fixture);
    await page.locator("#ll-start").click();
    assert.equal(await page.locator("#ll-error").isVisible(), true, JSON.stringify(fixture));
    assert.deepEqual(graph(await snapshot(page)), baseline);
    assert.equal(await status(page), "idle");
  }
  await closePage(page);
});

test("pause freezes graph, pointers, code and explanation; step and resume keep a single timer", async () => {
  const page = await openPage();
  await select(page, "reverse");
  await setSpeed(page, 1000);
  await page.locator("#ll-start").click();
  assert.equal(await status(page), "running");
  assert.equal(await page.locator("#ll-step").isDisabled(), true);
  for (const selector of ["#ll-create", "#ll-random", "#ll-clear", "#ll-operation", "#ll-start"]) {
    assert.equal(await page.locator(selector).isDisabled(), true, `${selector} is locked while busy`);
  }
  const first = await snapshot(page);
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) document.querySelector("#ll-start").dispatchEvent(new MouseEvent("click"));
    document.querySelector("#ll-step").dispatchEvent(new MouseEvent("click"));
    document.querySelector("#ll-random").dispatchEvent(new MouseEvent("click"));
    document.querySelector("#ll-clear").dispatchEvent(new MouseEvent("click"));
  });
  await page.clock.runFor(499);
  assert.deepEqual(await snapshot(page), first);
  await page.clock.runFor(1);
  assert.equal((await snapshot(page)).count, first.count + 1, "Repeated clicks cannot schedule parallel playback");
  await page.locator("#ll-pause").click();
  assert.equal(await status(page), "paused");
  const frozen = await snapshot(page);
  await page.clock.runFor(5000);
  assert.deepEqual(await snapshot(page), frozen);
  for (const selector of ["#ll-create", "#ll-random", "#ll-clear", "#ll-operation"]) assert.equal(await page.locator(selector).isDisabled(), true);
  await step(page);
  const stepped = await snapshot(page);
  await page.clock.runFor(1000);
  assert.deepEqual(await snapshot(page), stepped, "Manual step stays paused");
  await page.locator("#ll-pause").click();
  assert.equal(await status(page), "running");
  await finishAuto(page);
  await assertList(page, [40, 30, 20, 10]);
  await closePage(page);
});

test("speed endpoints and changes control subsequent playback intervals", async () => {
  const page = await openPage();
  assert.equal(await page.locator("#ll-speed").getAttribute("min"), "0");
  assert.equal(await page.locator("#ll-speed").getAttribute("max"), "1400");
  await select(page, "reverse");
  await setSpeed(page, 0);
  await page.locator("#ll-start").click();
  const before = (await snapshot(page)).count;
  await page.clock.runFor(1499);
  assert.equal((await snapshot(page)).count, before);
  await page.clock.runFor(1);
  assert.equal((await snapshot(page)).count, before + 1);
  await page.locator("#ll-pause").click();
  await setSpeed(page, 1400);
  await page.locator("#ll-pause").click();
  const resumed = (await snapshot(page)).count;
  await page.clock.runFor(99);
  assert.equal((await snapshot(page)).count, resumed);
  await page.clock.runFor(1);
  assert.equal((await snapshot(page)).count, resumed + 1);
  await page.clock.runFor(100);
  assert.equal((await snapshot(page)).count, resumed + 2);
  await closePage(page);
});

test("changing speed during running takes effect on subsequent steps without restarting the operation", async () => {
  const page = await openPage();
  await create(page, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  await select(page, "traverse");
  await setSpeed(page, 0);
  await page.locator("#ll-start").click();
  const started = (await snapshot(page)).count;
  await setSpeed(page, 1400);
  // Permit the already scheduled old-speed interval to finish. Every later
  // interval must honor the new speed, irrespective of rescheduling policy.
  await page.clock.runFor(1500);
  const changed = (await snapshot(page)).count;
  assert.ok(changed > started, "Changing speed preserves and advances the current run");
  assert.equal(await status(page), "running");
  await page.clock.runFor(99);
  assert.equal((await snapshot(page)).count, changed);
  await page.clock.runFor(1);
  assert.equal((await snapshot(page)).count, changed + 1, "The next interval uses 100 ms");
  await finishAuto(page);
  assert.deepEqual((await snapshot(page)).visited.match(/-?\d+/g).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  await closePage(page);
});

for (const operation of ["insert", "delete", "reverse"]) {
  for (const cancel of ["reset", "navigation"]) test(`${operation} ${cancel} restores exact graph and cancels old callbacks`, async () => {
    const page = await openPage();
    await create(page, [10, 20, 30, 40]);
    const baseline = graph(await snapshot(page));
    await select(page, operation, { ...(operation === "insert" ? { value: 15 } : {}), ...(operation !== "reverse" ? { position: 2 } : {}) });
    await setSpeed(page, 1400);
    await page.locator("#ll-start").click();
    let changed = false;
    for (let i = 0; i < 60 && await status(page) !== "completed"; i++) {
      if (JSON.stringify(graph(await snapshot(page))) !== JSON.stringify(baseline)) { changed = true; break; }
      await page.clock.runFor(100);
    }
    assert.ok(changed, "Cancellation is tested after an actual structure change");
    if (cancel === "reset") {
      await page.locator("#ll-pause").click();
      await page.locator("#ll-reset").click();
    } else {
      await page.locator("#nav-bubble").click();
      assert.equal(await page.locator("#linked-list-view").isVisible(), false);
    }
    assert.deepEqual(graph(await snapshot(page)), baseline);
    assert.equal(await status(page), "idle");
    const cancelled = await snapshot(page);
    await page.clock.runFor(10000);
    assert.deepEqual(await snapshot(page), cancelled, "Old callbacks cannot alter the restored graph");
    if (cancel === "navigation") await page.locator("#nav-list").click();
    await assertList(page, [10, 20, 30, 40], baseline.nodes.map((node) => node.id));
    await closePage(page);
  });
}

test("real browser timers: pause holds and reset cancels an outstanding reversal", async () => {
  const page = await openPage({ clock: false });
  const baseline = graph(await snapshot(page));
  await select(page, "reverse");
  await setSpeed(page, 1300);
  await page.locator("#ll-start").click();
  await page.waitForFunction(() => document.querySelector('#ll-canvas .ll-node[data-val="10"]').dataset.next === "null");
  await page.locator("#ll-pause").click();
  const frozen = await snapshot(page);
  await page.waitForTimeout(450);
  assert.deepEqual(await snapshot(page), frozen);
  await page.locator("#ll-pause").click();
  await page.locator("#ll-reset").click();
  assert.deepEqual(graph(await snapshot(page)), baseline);
  const reset = await snapshot(page);
  await page.waitForTimeout(450);
  assert.deepEqual(await snapshot(page), reset);
  await closePage(page);
});

for (const width of [1280, 390, 320]) test(`${width}px layout: 12 readable nodes scroll inside the canvas without page overflow`, async () => {
  const page = await openPage({ width });
  if (width === 1280) {
    await page.screenshot({ path: path.join(previewRoot, "linked-list-desktop.png"), fullPage: true });
    const original = trace(await snapshot(page));
    await select(page, "reverse");
    let backwardArrow = false;
    for (let i = 0; i < 30; i++) {
      const frame = await step(page);
      if (frame.nodes.find((node) => node.id === original[1].id).next === original[0].id) {
        backwardArrow = true;
        break;
      }
    }
    assert.ok(backwardArrow, "The reversal screenshot shows N2 pointing backward to N1");
    await page.screenshot({ path: path.join(previewRoot, "linked-list-reverse.png"), fullPage: true });
    await page.locator("#ll-reset").click();
  }
  await create(page, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector("#ll-canvas");
    let scroll = canvas;
    while (scroll && !(scroll.scrollWidth > scroll.clientWidth && /auto|scroll/.test(getComputedStyle(scroll).overflowX))) scroll = scroll.parentElement;
    let before = 0, after = 0;
    if (scroll) {
      before = scroll.scrollLeft;
      scroll.scrollLeft = 500;
      after = scroll.scrollLeft;
      scroll.scrollLeft = 0;
    }
    return {
      document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
      scrollFound: Boolean(scroll), before, after,
      nodeWidths: [...canvas.querySelectorAll(".ll-node")].map((node) => node.getBoundingClientRect().width)
    };
  });
  assert.ok(layout.document <= width + 1 && layout.body <= width + 1, `No page-wide overflow: ${JSON.stringify(layout)}`);
  assert.ok(layout.scrollFound && layout.after > layout.before, "The graph has a working horizontal scroll area");
  assert.ok(layout.nodeWidths.every((size) => size >= 80), "Nodes remain readable instead of shrinking to fit");
  await assertList(page, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  if (width === 390) await page.screenshot({ path: path.join(previewRoot, "linked-list-mobile.png"), fullPage: true });
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
  console.log(`${tests.length - failures}/${tests.length} linked-list browser acceptance checks passed.`);
  process.exitCode = failures ? 1 : 0;
})().catch(async (error) => {
  console.error(error.stack);
  if (browser) await browser.close();
  process.exitCode = 1;
});
