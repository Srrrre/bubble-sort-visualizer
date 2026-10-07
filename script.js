"use strict";

// 1. 输入校验：先得到完整的有效数组，再交给页面，错误不会覆盖原数据。
function parseArray(text) {
  const normalized = text.trim().replace(/，/g, ",");
  if (!normalized) throw new Error("请输入数组，例如：5, 3, 8, 2, 6。");
  if (/(^|,)\s*(,|$)/.test(normalized)) {
    throw new Error("逗号之间或首尾缺少数字，请补全数组。");
  }
  const tokens = normalized.split(/[,\s]+/);
  if (tokens.length < 2 || tokens.length > 20) {
    throw new Error(`需要 2～20 个整数，当前输入了 ${tokens.length} 个。`);
  }
  return tokens.map((token, index) => {
    // 不使用 parseInt：它会把 2.5、2abc 等不合法输入截断成 2。
    if (!/^[+-]?\d+$/.test(token)) {
      throw new Error(`第 ${index + 1} 项“${token}”不是整数；请勿输入小数、字母或科学计数法。`);
    }
    const value = Number(token);
    if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
      throw new Error(`第 ${index + 1} 项“${token}”超出范围，请输入 1～100 的整数。`);
    }
    return value;
  });
}

// 2. 算法：与 C++ 的两层循环相同，yield 把每一个可视化步骤交给播放器。
// 生成器只在 next() 时前进一步，不会一次执行完整个排序，也不负责等待。
function* bubbleSortSteps(input) {
  const values = [...input];
  let comparisons = 0;
  let swaps = 0;
  let round = 0;
  let sortedFrom = values.length; // [sortedFrom, 数组末尾] 已确定最终位置。
  const step = (type, indices, message) => ({
    type, indices, message, values: [...values], round, comparisons, swaps, sortedFrom
  });

  for (let end = values.length - 1; end > 0; end--) {
    round++;
    let swapped = false;
    for (let j = 0; j < end; j++) {
      const left = values[j];
      const right = values[j + 1];
      comparisons++;
      yield step("compare", [j, j + 1], `正在比较 ${left} 和 ${right}。`);
      if (left > right) {
        [values[j], values[j + 1]] = [values[j + 1], values[j]];
        swaps++;
        swapped = true;
        yield step("swap", [j, j + 1], `${left} 大于 ${right}，需要交换。`);
      } else {
        yield step("keep", [j, j + 1], `${left} 小于或等于 ${right}，不需要交换。`);
      }
    }
    sortedFrom = end;
    yield step("pass-end", [], `第 ${round} 轮结束，本轮最大值 ${values[end]} 已放到正确位置。`);
    if (!swapped) {
      sortedFrom = 0;
      yield step("done", [], "本轮没有交换，数组已经有序。全部元素已就位！");
      return;
    }
  }
  sortedFrom = 0;
  yield step("done", [], "排序完成！所有元素都已按从小到大的顺序排列。");
}

function initVisualizer() {
  const get = (id) => document.getElementById(id);
  const ui = {
    form: get("array-form"), input: get("array-input"), error: get("input-error"),
    apply: get("apply-button"), random: get("random-button"), start: get("start-button"),
    pause: get("pause-button"), reset: get("reset-button"), speed: get("speed-input"),
    speedOutput: get("speed-output"), chart: get("chart"), size: get("array-size"),
    status: get("status"), description: get("step-description"), round: get("round-count"),
    comparisons: get("comparison-count"), swaps: get("swap-count")
  };
  const state = {
    values: [5, 3, 8, 2, 6], initialValues: [5, 3, 8, 2, 6],
    status: "idle", iterator: null, timer: null, runId: 0, bars: [], animations: []
  };
  const isBusy = () => state.status === "running" || state.status === "paused";
  const interval = () => 1500 - Number(ui.speed.value); // 滑块向右，间隔更短。

  function updateControls() {
    ui.input.disabled = ui.apply.disabled = ui.random.disabled = isBusy();
    ui.start.disabled = isBusy();
    ui.start.textContent = state.status === "completed" ? "▶ 再次排序" : "▶ 开始排序";
    ui.pause.disabled = !isBusy();
    ui.pause.textContent = state.status === "paused" ? "▶ 继续" : "Ⅱ 暂停";
    ui.status.dataset.status = state.status;
    ui.status.textContent = { idle: "待开始", running: "排序中", paused: "已暂停", completed: "已完成" }[state.status];
  }

  function clearAnimations() {
    state.animations.forEach((animation) => animation.cancel());
    state.animations = [];
  }

  function cancelPlayback() {
    clearTimeout(state.timer);
    state.timer = null;
    state.runId++; // 即使旧回调已经进入队列，也不能再更新新任务的页面。
    state.iterator = null;
    clearAnimations();
  }

  function createBars() {
    state.bars = state.values.map(() => {
      const bar = document.createElement("div");
      bar.className = "bar-item";
      bar.setAttribute("role", "listitem");
      // 这里的 HTML 为固定模板，输入值只通过 textContent 写入。
      bar.innerHTML = '<div class="bar-track"><span class="bar-value"></span><div class="bar-fill"></div></div><span class="bar-state"></span><span class="bar-index"></span>';
      return bar;
    });
    ui.chart.replaceChildren(...state.bars);
    ui.chart.parentElement.scrollLeft = 0;
    ui.size.textContent = `${state.values.length} 个元素`;
    renderBars({ type: "idle", indices: [], sortedFrom: state.values.length });
  }

  function renderBars(step) {
    const maximum = Math.max(...state.values);
    const labels = { pending: "· 未处理", comparing: "? 比较中", swapping: "⇄ 交换中", sorted: "✓ 已就位" };
    state.bars.forEach((bar, index) => {
      let kind = index >= step.sortedFrom ? "sorted" : "pending";
      if (step.indices.includes(index)) kind = step.type === "swap" ? "swapping" : "comparing";
      bar.dataset.state = kind;
      bar.querySelector(".bar-value").textContent = state.values[index];
      bar.querySelector(".bar-fill").style.height = `${state.values[index] / maximum * 210}px`;
      bar.querySelector(".bar-state").textContent = labels[kind];
      bar.querySelector(".bar-index").textContent = index;
      bar.setAttribute("aria-label", `下标 ${index}，数值 ${state.values[index]}，${labels[kind]}`);
    });
  }

  function showStep(step) {
    clearAnimations();
    // 保留同一根柱子的 DOM 身份；交换后从旧位置平滑移动到新位置。
    const previousPositions = step.type === "swap"
      ? state.bars.map((bar) => bar.getBoundingClientRect().left) : [];
    if (step.type === "swap") {
      const [left, right] = step.indices;
      [state.bars[left], state.bars[right]] = [state.bars[right], state.bars[left]];
      ui.chart.replaceChildren(...state.bars);
    }
    state.values = [...step.values];
    renderBars(step);
    ui.round.textContent = step.round;
    ui.comparisons.textContent = step.comparisons;
    ui.swaps.textContent = step.swaps;
    ui.description.textContent = step.message;

    if (step.type === "swap" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const [left, right] = step.indices;
      for (const [newIndex, oldIndex] of [[left, right], [right, left]]) {
        const bar = state.bars[newIndex];
        const distance = previousPositions[oldIndex] - bar.getBoundingClientRect().left;
        const animation = bar.animate([
          { transform: `translateX(${distance}px)` }, { transform: "translateX(0)" }
        ], { duration: Math.min(240, interval() * 0.65), easing: "ease-in-out" });
        state.animations.push(animation);
      }
    }
  }

  // 3. 播放控制：任何时候最多只安排一个定时器，不阻塞主线程。
  function scheduleNext() {
    const currentRun = state.runId;
    state.timer = setTimeout(() => {
      if (currentRun !== state.runId || state.status !== "running") return;
      state.timer = null;
      advanceStep();
    }, interval());
  }

  function advanceStep() {
    if (state.status !== "running") return;
    const result = state.iterator.next();
    if (result.done) return;
    showStep(result.value);
    if (result.value.type === "done") {
      state.status = "completed";
      state.iterator = null;
      updateControls();
      return;
    }
    scheduleNext();
  }

  function clearError() {
    ui.error.hidden = true;
    ui.error.textContent = "";
    ui.input.removeAttribute("aria-invalid");
  }

  function reset() {
    cancelPlayback();
    state.status = "idle";
    state.values = [...state.initialValues];
    ui.input.value = state.values.join(", ");
    ui.round.textContent = ui.comparisons.textContent = ui.swaps.textContent = "0";
    ui.description.textContent = "准备好了。点击“开始排序”，观察第一对相邻元素。";
    clearError();
    createBars();
    updateControls();
  }

  function start() {
    if (isBusy()) return; // 禁用按钮之外再加一道保护，防止重复任务。
    cancelPlayback();
    state.initialValues = [...state.values];
    ui.input.value = state.values.join(", ");
    clearError();
    createBars();
    state.iterator = bubbleSortSteps(state.values);
    state.status = "running";
    updateControls();
    advanceStep();
  }

  function togglePause() {
    if (!isBusy()) return;
    if (state.status === "running") {
      clearTimeout(state.timer);
      state.timer = null;
      state.runId++;
      state.status = "paused";
      // 不仅暂停算法，也冻结正在移动的柱子；统计和步骤说明保持不变。
      state.animations.forEach((animation) => {
        if (animation.playState === "running") animation.pause();
      });
    } else {
      state.status = "running";
      state.animations.forEach((animation) => {
        if (animation.playState === "paused") animation.play();
      });
      scheduleNext(); // 恢复时保留当前步骤，等待一次间隔后再前进。
    }
    updateControls();
  }

  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isBusy()) return;
    try {
      const values = parseArray(ui.input.value);
      state.initialValues = values;
      reset();
    } catch (error) {
      ui.error.textContent = error.message;
      ui.error.hidden = false;
      ui.input.setAttribute("aria-invalid", "true");
    }
  });
  ui.random.addEventListener("click", () => {
    if (isBusy()) return;
    state.initialValues = Array.from({ length: 10 }, () => Math.floor(Math.random() * 100) + 1);
    reset();
  });
  ui.start.addEventListener("click", start);
  ui.pause.addEventListener("click", togglePause);
  ui.reset.addEventListener("click", reset);
  ui.speed.addEventListener("input", () => {
    ui.speedOutput.textContent = `每步 ${interval()} 毫秒`;
    ui.speed.setAttribute("aria-valuetext", ui.speedOutput.textContent);
    // 当前等待保持不变，下一个步骤安排定时器时读取新速度。
  });
  // 切换学习模块时，取消隐藏页面中的未完成排序，避免后台继续播放。
  window.addEventListener("learning:view-change", (event) => {
    if (event.detail !== "bubble" && isBusy()) reset();
  });
  reset();
}

// 浏览器直接执行；Node 只导入两个纯函数，供可选测试使用，无需构建。
if (typeof document !== "undefined") initVisualizer();
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseArray, bubbleSortSteps };
}
