"use strict";

// 算法在 linked-list-core.js；本文件只负责导航、播放状态与关系图。
(() => {
  const core = globalThis.LinkedListCore;
  const get = (id) => document.getElementById(id);
  const ui = Object.fromEntries([
    "input", "create", "random", "clear", "operation", "value", "position", "error",
    "start", "pause", "step", "reset", "speed", "speed-output", "status", "length",
    "length-label", "description", "step-count", "visited", "pointers", "canvas", "scroll",
    "sequence", "layout-hint", "code", "code-title", "code-scroll", "principle", "complexity"
  ].map((key) => [key, get(`ll-${key}`)]));
  const state = {
    model: core.createList([10, 20, 30, 40]), before: null, iterator: null,
    status: "idle", operation: "traverse", timer: null, runId: 0,
    count: 0, frame: null, layout: [], detached: null, activeView: null
  };
  const busy = () => state.status === "running" || state.status === "paused";
  const delay = () => 1500 - Number(ui.speed.value);
  const pointerNames = {
    traverse: ["p"], search: ["p"], insert: ["prev", "newNode"],
    delete: ["prev", "target"], reverse: ["prev", "curr", "next"]
  };
  const principles = {
    traverse: "指针保存的是节点的引用。沿 next 移动指针，不会移动或复制节点本身。",
    search: "从 head 出发依次比较；找到第一个匹配节点就停止。相同的数值并不意味着是同一个节点。",
    insert: "先让新节点接住原来的后继，再改前驱或 head。这样能保留后半段链表的入口。",
    delete: "先用 target 保存待删节点，再让前驱或 head 绕过它，最后模拟 delete；释放后不再访问该节点。",
    reverse: "curr->next 改向 prev 后，原来的去路就消失了。先用 next 保存后继，curr 才能继续向前。"
  };

  function clearError() {
    ui.error.hidden = true;
    ui.error.textContent = "";
  }
  function showError(error) {
    ui.error.hidden = false;
    ui.error.textContent = error.message;
  }
  function cancelTimer() {
    clearTimeout(state.timer);
    state.timer = null;
    state.runId++; // 让已排队的旧回调也失效，不依赖 clearTimeout 单独保证安全。
  }
  function updateControls() {
    for (const key of ["input", "create", "random", "clear", "operation", "value", "position", "start"]) {
      ui[key].disabled = busy();
    }
    ui.pause.disabled = !busy();
    ui.pause.textContent = state.status === "paused" ? "▶ 继续" : "Ⅱ 暂停";
    ui.step.disabled = state.status === "running";
    ui.status.dataset.status = state.status;
    ui.status.textContent = { idle: "待开始", running: "演示中", paused: "已暂停", completed: "已完成" }[state.status];
    ui["length-label"].textContent = busy() ? "开始时长度" : "长度";
    ui.length.textContent = busy() ? state.before.length : state.model.length;
  }

  function showCode() {
    const code = core.CODES[state.operation];
    ui["code-title"].textContent = `C++ · ${code.title}`;
    ui.code.replaceChildren(...code.lines.map((text, index) => {
      const line = document.createElement("span");
      line.className = "ll-code-line";
      line.dataset.line = index + 1;
      line.textContent = text || " ";
      return line;
    }));
    ui["code-scroll"].scrollTop = 0;
    ui.principle.textContent = principles[state.operation];
    ui.complexity.textContent = `${code.complexity} 可视化另外使用 O(n) 的节点快照和绘图空间，不属于算法本身的辅助空间。`;
  }

  function updateOperationFields() {
    const op = state.operation;
    get("ll-position-field").hidden = op !== "insert" && op !== "delete";
    get("ll-value-field").hidden = op !== "insert" && op !== "search";
    get("ll-value-label").textContent = op === "search" ? "查找值（-99～99）" : "节点值（-99～99）";
    get("ll-operation-hint").textContent = {
      traverse: "p 从 head 出发，沿 next 访问每一个节点。",
      search: "查找第一个匹配节点，返回从 1 开始的位置。",
      insert: `合法位置 1～${state.model.length + 1}；先接后继，再修改入口。最多 12 个节点。`,
      delete: state.model.length ? `合法位置 1～${state.model.length}；先绕过，再模拟释放。` : "空链表没有可删除的节点。",
      reverse: "每轮分成四步：保存 next → 反转连接 → 移动 prev → 移动 curr。"
    }[op];
  }

  const svgNS = "http://www.w3.org/2000/svg";
  function svgElement(tag, attributes) {
    const element = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }
  function label(className, text, x, y) {
    const element = document.createElement("span");
    element.className = className;
    element.textContent = text;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    ui.canvas.append(element);
    return element;
  }

  // 只用数组决定布局，箭头必须读取 node.next。即使 head 暂时到不了，也画出所有存活节点。
  function renderGraph(previousModel) {
    const model = state.model;
    const frame = state.frame || { pointers: {}, roles: {} };
    const releasedPointers = frame.releasedPointers || {};
    const pointers = { head: model.head };
    for (const name of pointerNames[state.operation]) {
      if (Object.hasOwn(frame.pointers, name)) pointers[name] = frame.pointers[name];
    }
    ui.pointers.replaceChildren(...Object.entries(pointers).map(([name, id]) => {
      const chip = document.createElement("span");
      chip.className = "ll-pointer-value";
      chip.dataset.pointer = name;
      chip.dataset.target = id || "null";
      chip.textContent = releasedPointers[name] ? `${name} → 已释放 ${id}（悬空）` : `${name} → ${id || "nullptr"}`;
      if (releasedPointers[name]) chip.dataset.state = "released";
      return chip;
    }));

    const nodes = Object.values(model.nodes);
    const positions = {};
    const sideNodes = nodes.filter((node) => !state.layout.includes(node.id) || node.id === state.detached);
    const width = Math.max(640, state.layout.length * 180 + 270);
    const height = sideNodes.length ? 640 : 440;
    ui.canvas.style.width = `${width}px`;
    ui.canvas.style.height = `${height}px`;
    ui.canvas.dataset.head = model.head || "null";
    ui.canvas.replaceChildren();
    const svg = svgElement("svg", { class: "ll-edges", width, height, "aria-hidden": "true" });
    const defs = svgElement("defs", {});
    const marker = svgElement("marker", { id: "ll-arrow", markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: "auto", markerUnits: "userSpaceOnUse" });
    marker.append(svgElement("path", { d: "M 0 0 L 8 4 L 0 8 Z", fill: "context-stroke" }));
    defs.append(marker);
    svg.append(defs);
    ui.canvas.append(svg);
    function arrow(d, attributes) {
      svg.append(svgElement("path", { d, "marker-end": "url(#ll-arrow)", ...attributes }));
    }

    nodes.forEach((node) => {
      const slot = state.layout.indexOf(node.id);
      const side = sideNodes.includes(node);
      // 新节点先在旁边分配；删除目标在 detach 步骤移入旁边区域。
      const sideSlot = slot >= 0 ? slot : Math.max(0, Math.min(Number(ui.position.value) - 1 || 0, state.layout.length - 1));
      positions[node.id] = { x: 90 + (side ? sideSlot : slot) * 180, y: side ? 345 : 140 };
    });
    if (sideNodes.length) label("ll-lane-label", "临时节点区域 · 尚未整理到主链", 26, 288);

    nodes.forEach((node, index) => {
      const pos = positions[node.id];
      const roles = [...(frame.roles[node.id] || [])];
      if (node.id === state.detached && !roles.includes("已脱离")) roles.push("已脱离");
      const bar = document.createElement("div");
      bar.className = "ll-node";
      bar.dataset.id = node.id;
      bar.dataset.val = node.val;
      bar.dataset.next = node.next || "null";
      let kind = "normal";
      if (roles.some((r) => r.includes("已访问") || r.includes("已反转"))) kind = "visited";
      if (pointers.prev === node.id) kind = "previous";
      if (pointers.p === node.id || pointers.curr === node.id) kind = "current";
      if (pointers.newNode === node.id && !state.frame?.done) kind = "new";
      if (pointers.target === node.id) kind = "target";
      bar.dataset.kind = kind;
      bar.style.left = `${pos.x}px`;
      bar.style.top = `${pos.y}px`;
      bar.innerHTML = '<div class="ll-node-header"><b class="ll-node-id"></b><span class="ll-node-position"></span></div><div class="ll-fields"><div><span class="ll-field-name">val</span><span class="ll-node-value"></span></div><div><span class="ll-field-name">next</span><span class="ll-next-value"></span></div></div><span class="ll-node-roles"></span>';
      bar.querySelector(".ll-node-id").textContent = node.id;
      // 操作中不把固定布局槽位当成链表位置，避免反转期间误导。
      bar.querySelector(".ll-node-position").textContent = busy() ? "节点" : `位置 ${state.layout.indexOf(node.id) + 1}`;
      bar.querySelector(".ll-node-value").textContent = node.val;
      bar.querySelector(".ll-next-value").textContent = node.next || "nullptr";
      bar.querySelector(".ll-node-roles").textContent = roles.join(" · ");
      bar.setAttribute("aria-label", `${node.id}，值 ${node.val}，next 指向 ${node.next || "nullptr"}，${roles.join("，")}`);
      ui.canvas.append(bar);

      const sx = pos.x + 128, sy = pos.y + 59;
      let path;
      if (node.next !== null) {
        const target = positions[node.next];
        if (!target) throw new Error("检测到无效的 next 引用。");
        if (target.y === pos.y && (target.x < pos.x || target.x - pos.x > 210)) {
          // 反向或跨节点的箭头从底部绕行，不穿过数据卡片。
          const lane = pos.y + 146 + (index % 3) * 24;
          path = `M ${pos.x + 102} ${pos.y + 94} C ${pos.x + 102} ${lane}, ${target.x + 25} ${lane}, ${target.x + 25} ${target.y + 96}`;
        } else {
          path = `M ${sx} ${sy} C ${sx + 25} ${sy}, ${target.x - 25} ${target.y + 59}, ${target.x - 3} ${target.y + 59}`;
        }
      } else {
        const rightmost = !nodes.some((other) => positions[other.id].y === pos.y && positions[other.id].x > pos.x);
        const nx = rightmost ? sx + 28 : pos.x + 27;
        const ny = rightmost ? sy - 14 : pos.y + 220;
        label("ll-null", "nullptr", nx, ny);
        path = rightmost ? `M ${sx} ${sy} L ${nx - 3} ${sy}`
          : `M ${sx} ${sy} L ${sx + 15} ${sy} L ${sx + 15} ${ny + 14} L ${nx + 79} ${ny + 14}`;
      }
      const changed = previousModel && previousModel.nodes[node.id]?.next !== node.next;
      arrow(path, { class: `ll-edge${changed ? " changed" : ""}`, "data-from": node.id, "data-to": node.next || "null" });
    });

    let nullIndex = 0;
    for (const [name, id] of Object.entries(pointers)) {
      if (releasedPointers[name]) {
        // delete 不会自动把局部指针置空；明确标出悬空状态，不再画成有效指向。
        const tag = label("ll-null-pointer", `${name} → 已释放 ${id}（勿访问）`, 24 + nullIndex * 140, 20);
        tag.dataset.state = "released";
        nullIndex++;
      } else if (id === null) {
        if (name === "head" && !nodes.length) {
          label("ll-diagram-pointer", "head", 80, 145).dataset.name = "head";
          label("ll-null", "nullptr", 208, 143);
          arrow("M 141 157 L 205 157", { class: "ll-pointer-line", "data-pointer": "head" });
        } else {
          label("ll-null-pointer", `${name} → nullptr`, 24 + nullIndex * 140, 20);
          nullIndex++;
        }
      } else if (positions[id]) {
        const group = Object.entries(pointers).filter((entry) => entry[1] === id);
        const slot = group.findIndex((entry) => entry[0] === name);
        const pos = positions[id];
        const x = pos.x + (slot % 2) * 67;
        const y = pos.y - 42 - Math.floor(slot / 2) * 29;
        label("ll-diagram-pointer", name, x, y).dataset.name = name;
        arrow(`M ${x + 30} ${y + 24} L ${pos.x + 16 + slot * 22} ${pos.y - 3}`, { class: "ll-pointer-line", "data-pointer": name, "data-target": id });
      }
    }

    if (busy()) {
      ui.sequence.textContent = "操作进行中：以图中的箭头和指针为准，暂时脱离 head 的节点仍然显示。";
    } else {
      const ids = core.reachableIds(model);
      ui.sequence.textContent = `head → ${ids.map((id) => `${id}(${model.nodes[id].val}) → `).join("")}nullptr`;
    }
    ui["layout-hint"].textContent = state.operation === "reverse" && busy()
      ? "反转时保持节点位置，先观察 next 箭头改变方向；完成后再整理布局。"
      : "横向排列方便阅读，不代表节点在内存中连续存储。编号不是地址或位置。";
  }

  function renderFrame(previousModel) {
    updateControls();
    renderGraph(previousModel);
    ui["step-count"].textContent = state.count;
    ui.description.textContent = state.frame?.message || "选择一个操作。可以自动播放，也可以用“下一步”慢慢观察指针。";
    ui.visited.textContent = `已访问：${state.frame?.visited.length ? state.frame.visited.join(" → ") : "—"}`;
    for (const line of ui.code.children) {
      const active = Number(line.dataset.line) === state.frame?.line;
      line.classList.toggle("active", active);
      if (active) line.setAttribute("aria-current", "step");
      else line.removeAttribute("aria-current");
    }
    const active = ui.code.querySelector(".active");
    if (active && !get("linked-list-view").hidden) {
      const container = ui["code-scroll"];
      const top = active.offsetTop;
      if (top < container.scrollTop || top + 25 > container.scrollTop + container.clientHeight) container.scrollTop = Math.max(0, top - 100);
    }
  }

  function resetOperation() {
    cancelTimer();
    if (state.before) state.model = core.cloneList(state.before);
    state.iterator = null;
    state.status = "idle";
    state.count = 0;
    state.frame = null;
    state.detached = null;
    state.layout = core.reachableIds(state.model);
    clearError();
    updateOperationFields();
    renderFrame();
  }

  function prepareOperation(mode) {
    try {
      const args = core.validateOperation(state.model, state.operation, { position: ui.position.value, value: ui.value.value });
      cancelTimer();
      state.before = core.cloneList(state.model);
      state.iterator = core.operationSteps(state.model, state.operation, args);
      state.layout = core.reachableIds(state.model);
      state.detached = null;
      state.frame = null;
      state.count = 0;
      state.status = mode;
      clearError();
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  }

  function scheduleNext() {
    const run = state.runId;
    state.timer = setTimeout(() => {
      if (run !== state.runId || state.status !== "running") return;
      state.timer = null;
      advanceOneStep();
      if (state.status === "running") scheduleNext();
    }, delay());
  }

  function advanceOneStep() {
    if (!busy()) return;
    try {
      const next = state.iterator.next();
      if (next.done) return;
      const previous = state.model;
      state.frame = next.value;
      state.model = next.value.model;
      state.count++;
      if (next.value.type === "detach") state.detached = next.value.pointers.target;
      if (next.value.done) {
        state.status = "completed";
        state.iterator = null;
        state.detached = null;
        state.layout = core.reachableIds(state.model);
        updateOperationFields();
      }
      renderFrame(previous);
    } catch (error) {
      resetOperation();
      showError(new Error(`演示无法继续，已恢复操作前的链表：${error.message}`));
    }
  }

  ui.start.addEventListener("click", () => {
    if (busy() || !prepareOperation("running")) return;
    advanceOneStep();
    if (state.status === "running") scheduleNext();
  });
  ui.step.addEventListener("click", () => {
    if (state.status === "running") return;
    if (state.status !== "paused" && !prepareOperation("paused")) return;
    advanceOneStep();
  });
  ui.pause.addEventListener("click", () => {
    if (!busy()) return;
    if (state.status === "running") {
      cancelTimer();
      state.status = "paused";
    } else {
      state.status = "running";
      scheduleNext();
    }
    updateControls(); // 暂停只改按钮，不重画图或改代码高亮与说明。
  });
  ui.reset.addEventListener("click", resetOperation);
  ui.speed.addEventListener("input", () => {
    ui["speed-output"].textContent = `每步 ${delay()} 毫秒`;
    ui.speed.setAttribute("aria-valuetext", ui["speed-output"].textContent);
  });

  function replaceList(values) {
    if (busy()) return;
    state.model = core.createList(values);
    state.before = null;
    resetOperation();
    ui.input.value = values.join(", ");
    ui.scroll.scrollLeft = 0;
  }
  get("ll-create-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy()) return;
    try { replaceList(core.parseValues(ui.input.value)); } catch (error) { showError(error); }
  });
  ui.random.addEventListener("click", () => {
    if (busy()) return;
    replaceList(Array.from({ length: 5 + Math.floor(Math.random() * 4) }, () => Math.floor(Math.random() * 199) - 99));
  });
  ui.clear.addEventListener("click", () => replaceList([]));
  ui.operation.addEventListener("change", () => {
    if (busy()) { ui.operation.value = state.operation; return; }
    state.operation = ui.operation.value;
    state.before = null;
    showCode();
    resetOperation();
  });

  // 使用同页模块切换，完成后的链表保留；未完成操作先回滚快照再隐藏。
  function switchView(view, updateHash = false) {
    if (view === state.activeView) return;
    if (view !== "list" && busy()) resetOperation();
    window.dispatchEvent(new CustomEvent("learning:view-change", { detail: view }));
    state.activeView = view;
    get("bubble-view").hidden = view !== "bubble";
    get("linked-list-view").hidden = view !== "list";
    get("nav-bubble").setAttribute("aria-pressed", String(view === "bubble"));
    get("nav-list").setAttribute("aria-pressed", String(view === "list"));
    document.title = view === "list" ? "单链表可视化 · 算法实验室" : "冒泡排序可视化 · 算法实验室";
    if (updateHash) location.hash = view === "list" ? "linked-list" : "bubble-sort";
  }
  get("nav-bubble").addEventListener("click", () => switchView("bubble", true));
  get("nav-list").addEventListener("click", () => switchView("list", true));
  window.addEventListener("hashchange", () => switchView(location.hash === "#linked-list" ? "list" : "bubble"));
  window.addEventListener("pagehide", () => { if (busy()) resetOperation(); });
  showCode();
  resetOperation();
  switchView(location.hash === "#linked-list" ? "list" : "bubble");
})();
