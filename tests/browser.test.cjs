"use strict";

// Optional browser acceptance checks. The website itself has no dependencies.
// Install Playwright separately, or set PLAYWRIGHT_MODULE to its existing path.
// Run: node tests/browser.test.cjs (Microsoft Edge must be installed).
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const projectRoot = path.resolve(__dirname, "..");
const pageURL = pathToFileURL(path.join(projectRoot, "index.html")).href;
const previewRoot = path.resolve(projectRoot, "..");
const defaults = [5, 3, 8, 2, 6];
const tests = [];
let browser;

const test = (name, body) => tests.push({ name, body });
const ascending = (values) => [...values].sort((a, b) => a - b);
const values = (page) => page.locator(".bar-value").allTextContents().then((items) => items.map(Number));
const status = (page) => page.locator("#status").getAttribute("data-status");
const snapshot = (page) => page.evaluate(() => ({
  values: [...document.querySelectorAll(".bar-value")].map((element) => Number(element.textContent)),
  states: [...document.querySelectorAll(".bar-item")].map((element) => element.dataset.state),
  comparisons: Number(document.querySelector("#comparison-count").textContent),
  swaps: Number(document.querySelector("#swap-count").textContent),
  round: Number(document.querySelector("#round-count").textContent),
  description: document.querySelector("#step-description").textContent
}));

async function openPage({ width = 1280, clock = true, reducedMotion = "no-preference" } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
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
  await page.goto(pageURL);
  assert.deepEqual(await values(page), defaults, "The file URL must initialize all default bars");
  assert.equal(await status(page), "idle");
  return page;
}

async function closePage(page) {
  assert.deepEqual(page.acceptanceErrors, [], "No console errors, uncaught errors or network dependencies");
  await page.close();
}

async function apply(page, array) {
  await page.locator("#array-input").fill(Array.isArray(array) ? array.join(", ") : array);
  await page.locator("#apply-button").click();
  assert.equal(await status(page), "idle");
  assert.equal(await page.locator("#input-error").isVisible(), false);
}

async function speed(page, value) {
  await page.locator("#speed-input").fill(String(value));
  assert.match(await page.locator("#speed-output").textContent(), new RegExp(String(1500 - value)));
  assert.match(await page.locator("#speed-input").getAttribute("aria-valuetext"), new RegExp(String(1500 - value)));
}

async function locked(page, expected) {
  for (const selector of ["#array-input", "#apply-button", "#random-button", "#start-button"]) {
    assert.equal(await page.locator(selector).isDisabled(), expected, `${selector} busy-state lock`);
  }
}

async function finish(page, limit = 70000) {
  let elapsed = 0;
  while ((await status(page)) !== "completed" && elapsed < limit) {
    await page.clock.runFor(1000);
    elapsed += 1000;
  }
  assert.equal(await status(page), "completed", `Must finish within ${limit} virtual milliseconds`);
}

const cases = [
  { name: "default", input: defaults, comparisons: 10, swaps: 5, round: 4 },
  { name: "ascending", input: [1, 2, 3, 4, 5], comparisons: 4, swaps: 0, round: 1 },
  { name: "descending", input: [5, 4, 3, 2, 1], comparisons: 10, swaps: 10, round: 4 },
  { name: "duplicates", input: [3, 1, 3, 2, 1], comparisons: 10, swaps: 6, round: 4 },
  { name: "all equal", input: [7, 7, 7, 7], comparisons: 3, swaps: 0, round: 1 },
  { name: "two elements", input: [2, 1], comparisons: 1, swaps: 1, round: 1 },
  { name: "20 elements", input: Array.from({ length: 20 }, (_, i) => 20 - i), comparisons: 190, swaps: 190, round: 19 }
];

for (const example of cases) {
  test(`sort ${example.name}: exact result, multiset, counters and final states`, async () => {
    const page = await openPage();
    if (example.name !== "default") await apply(page, example.input);
    await speed(page, 1400);
    await page.locator("#start-button").click();
    await finish(page);
    const actual = await snapshot(page);
    assert.deepEqual(actual.values, ascending(example.input));
    assert.deepEqual(ascending(actual.values), ascending(example.input), "Preserve the input multiset");
    assert.equal(actual.comparisons, example.comparisons);
    assert.equal(actual.swaps, example.swaps);
    assert.equal(actual.round, example.round);
    assert.equal(await page.locator('.bar-item[data-state="sorted"]').count(), example.input.length);
    assert.ok(actual.description.length > 0);
    await locked(page, false);
    assert.equal(await page.locator("#pause-button").isDisabled(), true);
    await closePage(page);
  });
}

test("pause freezes steps; resume continues; duplicate start and busy input cannot create another task", async () => {
  const page = await openPage();
  await apply(page, [3, 2, 1]);
  await speed(page, 1000); // 500 ms per step.
  await page.locator("#start-button").click();
  await locked(page, true);
  const first = await snapshot(page);
  assert.equal(first.comparisons, 1);
  assert.equal(first.swaps, 0);
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) document.querySelector("#start-button").dispatchEvent(new MouseEvent("click"));
    document.querySelector("#random-button").dispatchEvent(new MouseEvent("click"));
    document.querySelector("#array-form").dispatchEvent(new Event("submit", { cancelable: true }));
  });
  await page.clock.runFor(499);
  assert.deepEqual(await snapshot(page), first, "One timer only; full delay precedes the next step");
  await page.clock.runFor(1);
  const second = await snapshot(page);
  assert.deepEqual(second.values, [2, 3, 1]);
  assert.equal(second.swaps, 1);
  assert.equal(second.comparisons, 1);
  await page.locator("#pause-button").click();
  assert.equal(await status(page), "paused");
  await locked(page, true);
  const paused = await snapshot(page);
  await page.clock.runFor(5000);
  assert.deepEqual(await snapshot(page), paused, "Values, statistics, round and explanation freeze");
  await page.locator("#pause-button").click();
  assert.equal(await status(page), "running");
  assert.deepEqual(await snapshot(page), paused, "Resume preserves current step");
  await page.clock.runFor(499);
  assert.deepEqual(await snapshot(page), paused);
  await page.clock.runFor(1);
  assert.equal((await snapshot(page)).comparisons, 2, "Resume advances exactly one comparison");
  await speed(page, 1400);
  await finish(page);
  assert.equal((await snapshot(page)).comparisons, 3);
  assert.equal((await snapshot(page)).swaps, 3);
  await closePage(page);
});

test("reset cancels old callbacks, restores the original array, and completion can restart", async () => {
  const page = await openPage();
  const input = [4, 3, 2, 1];
  await apply(page, input);
  await speed(page, 1400);
  await page.locator("#start-button").click();
  await page.clock.runFor(300);
  assert.notDeepEqual(await values(page), input);
  await page.locator("#reset-button").click();
  assert.equal(await status(page), "idle");
  assert.deepEqual(await values(page), input);
  const reset = await snapshot(page);
  assert.equal(reset.comparisons, 0);
  assert.equal(reset.swaps, 0);
  assert.equal(reset.round, 0);
  await page.clock.runFor(2000);
  assert.deepEqual(await snapshot(page), reset, "Cancelled callbacks cannot alter reset state");
  await page.locator("#start-button").click();
  await page.clock.runFor(100);
  await page.locator("#pause-button").click();
  await page.locator("#reset-button").click();
  assert.deepEqual(await values(page), input, "Reset while paused restores the starting array");
  await page.locator("#start-button").click();
  await finish(page);
  const completed = await snapshot(page);
  assert.equal(completed.comparisons, 6);
  assert.equal(completed.swaps, 6);
  await page.locator("#start-button").click();
  await finish(page);
  const restarted = await snapshot(page);
  assert.deepEqual(restarted.values, [1, 2, 3, 4]);
  assert.equal(restarted.comparisons, 3);
  assert.equal(restarted.swaps, 0);
  assert.equal(restarted.round, 1);
  await page.locator("#reset-button").click();
  assert.deepEqual(await values(page), [1, 2, 3, 4], "Reset uses this run's starting array");
  await closePage(page);
});

test("input validation, mixed delimiters, speed endpoints and random bounds", async () => {
  const page = await openPage();
  const invalid = ["", "1", "1,2.5", "0,2", "1,101", "1,,2", "1,", "1,a", "1,2e1", Array(21).fill(2).join(",")];
  for (const text of invalid) {
    await page.locator("#array-input").fill(text);
    await page.locator("#apply-button").click();
    assert.equal(await page.locator("#input-error").isVisible(), true, `Reject ${JSON.stringify(text)}`);
    assert.equal(await page.locator("#array-input").getAttribute("aria-invalid"), "true");
    assert.deepEqual(await values(page), defaults, "An invalid input must preserve the current chart");
  }
  await apply(page, "100， 2  1, 25");
  assert.deepEqual(await values(page), [100, 2, 1, 25]);
  assert.equal(await page.locator("#array-input").getAttribute("aria-invalid"), null);
  assert.equal(await page.locator("#speed-input").getAttribute("min"), "0");
  assert.equal(await page.locator("#speed-input").getAttribute("max"), "1400");
  await speed(page, 0);
  await speed(page, 1400);
  for (let i = 0; i < 8; i++) {
    await page.locator("#random-button").click();
    const generated = await values(page);
    assert.equal(generated.length, 10);
    assert.ok(generated.every((value) => Number.isInteger(value) && value >= 1 && value <= 100));
    assert.equal((await snapshot(page)).comparisons, 0);
  }
  await closePage(page);
});

test("real timers and WAAPI: pause freezes an in-flight swap, then resumes", async () => {
  const page = await openPage({ clock: false });
  await apply(page, [2, 1]);
  await speed(page, 0);
  await page.locator("#start-button").click();
  await page.waitForFunction(() => Number(document.querySelector("#swap-count").textContent) === 1, undefined, { polling: "raf" });
  // Pause from the DOM immediately, before the 240 ms swap animation completes.
  await page.locator("#pause-button").evaluate((button) => button.click());
  await page.waitForTimeout(70); // Allow WAAPI's pending pause to settle at a frame.
  assert.equal(await status(page), "paused");
  const animationState = await page.locator(".bar-item").evaluateAll((bars) => bars.flatMap((bar) => bar.getAnimations().map((animation) => ({ state: animation.playState, time: animation.currentTime }))));
  assert.equal(animationState.length, 2, "Both exchanging bars have an active animation");
  assert.ok(animationState.every((animation) => animation.state === "paused"));
  const frozen = await snapshot(page);
  const positions = await page.locator(".bar-item").evaluateAll((bars) => bars.map((bar) => bar.getBoundingClientRect().x));
  await page.waitForTimeout(1700);
  assert.deepEqual(await snapshot(page), frozen);
  const laterPositions = await page.locator(".bar-item").evaluateAll((bars) => bars.map((bar) => bar.getBoundingClientRect().x));
  positions.forEach((value, i) => assert.ok(Math.abs(value - laterPositions[i]) < 0.1, "Paused bars remain visually stationary"));
  await page.locator("#pause-button").click();
  assert.deepEqual(await snapshot(page), frozen);
  await page.waitForFunction(() => document.querySelector("#status").dataset.status === "completed", undefined, { timeout: 5000 });
  assert.deepEqual(await values(page), [1, 2]);
  assert.equal((await snapshot(page)).comparisons, 1);
  assert.equal((await snapshot(page)).swaps, 1);
  await closePage(page);
});

test("keyboard focus is visible and Enter applies a valid array", async () => {
  const page = await openPage();
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#array-input").evaluate((element) => element === document.activeElement), true);
  const focus = await page.locator("#array-input").evaluate((element) => ({
    visible: element.matches(":focus-visible"),
    outlineStyle: getComputedStyle(element).outlineStyle,
    outlineWidth: Number.parseFloat(getComputedStyle(element).outlineWidth)
  }));
  assert.equal(focus.visible, true);
  assert.notEqual(focus.outlineStyle, "none");
  assert.ok(focus.outlineWidth >= 2);
  await page.locator("#array-input").fill("8, 1, 3");
  await page.keyboard.press("Enter");
  assert.deepEqual(await values(page), [8, 1, 3]);
  await closePage(page);
});

for (const width of [1280, 390, 320]) {
  test(`layout at ${width}px: page fits, 20 bars remain scrollable`, async () => {
    const page = await openPage({ width });
    if (width === 1280) {
      await speed(page, 0);
      await page.locator("#start-button").click();
      await page.screenshot({ path: path.join(previewRoot, "preview-desktop.png"), fullPage: true });
      await page.locator("#reset-button").click();
    }
    await apply(page, Array.from({ length: 20 }, (_, i) => 100 - i * 4));
    const layout = await page.evaluate(() => {
      const scroll = document.querySelector(".chart-scroll");
      const before = scroll.scrollLeft;
      scroll.scrollLeft = 1000;
      const after = scroll.scrollLeft;
      scroll.scrollLeft = 0;
      return { viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, chartWidth: scroll.clientWidth, chartScrollWidth: scroll.scrollWidth, before, after };
    });
    assert.ok(layout.document <= width + 1, `Document overflows: ${JSON.stringify(layout)}`);
    assert.ok(layout.body <= width + 1, `Body overflows: ${JSON.stringify(layout)}`);
    assert.ok(layout.chartScrollWidth > layout.chartWidth);
    assert.ok(layout.after > layout.before, "The chart scroll container must actually scroll");
    if (width === 390) await page.screenshot({ path: path.join(previewRoot, "preview-mobile.png"), fullPage: true });
    await closePage(page);
  });
}

test("reduced-motion preference retains sorting functionality", async () => {
  const page = await openPage({ reducedMotion: "reduce" });
  await apply(page, [2, 1]);
  await speed(page, 1400);
  await page.locator("#start-button").click();
  await page.clock.runFor(100);
  assert.equal(await page.locator(".bar-item").evaluateAll((bars) => bars.flatMap((bar) => bar.getAnimations()).length), 0);
  await finish(page);
  assert.deepEqual(await values(page), [1, 2]);
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
    }
  }
  await browser.close();
  console.log(`${tests.length - failures}/${tests.length} browser acceptance checks passed.`);
  process.exitCode = failures ? 1 : 0;
})().catch(async (error) => {
  console.error(error.stack);
  if (browser) await browser.close();
  process.exitCode = 1;
});
