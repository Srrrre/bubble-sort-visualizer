"use strict";

// core 生成与 C++ 语义一致的步骤；本文件消费步骤，不自行决定遍历顺序。
(() => {
  const core = globalThis.BinaryTreeCore;
  const get = (id) => document.getElementById(id);
  const ui = Object.fromEntries([
    "input", "create", "default", "operation", "error", "start", "pause", "step", "reset",
    "speed", "speed-output", "status", "count", "tree-depth", "current", "recursion-depth",
    "level", "step-count", "description", "result", "current-code", "stack", "queue", "code",
    "code-title", "code-scroll", "complexity", "principle", "canvas", "scroll", "path"
  ].map((key) => [key, get(`bt-${key}`)]));
  const state = {
    model: core.parseTree(core.DEFAULT_INPUT), before: null, operation: "preorder",
    status: "idle", frame: null, iterator: null, timer: null, runId: 0, count: 0
  };
  const phases = {
    entering: "进入函数", checking: "判断是否为空", "ready-left": "准备递归左子树",
    "ready-right": "准备递归右子树", "ready-visit": "准备访问节点", visiting: "访问并记录节点",
    "waiting-left": "等待左子树返回", "waiting-right": "等待右子树返回", returning: "函数即将返回"
  };
  const orders = {
    preorder: "根 → 左 → 右：先访问自己，再递归处理孩子。",
    inorder: "左 → 根 → 右：左子树返回之后，才访问当前节点。",
    postorder: "左 → 右 → 根：两个子树都返回之后，才访问当前节点。",
    levelorder: "从上到下、从左到右：队首出队并访问，左孩子先于右孩子入队。"
  };
  const busy = () => state.status === "running" || state.status === "paused";
  const delay = () => 1500 - Number(ui.speed.value);
  const label = (id) => id === null ? "nullptr" : `${state.model.nodes[id].val} [${id}]`;
  const emptyFrame = () => ({ nodeId: null, stack: [], queue: [], visitedIds: [], completedIds: [], pathIds: [], activeEdge: null, line: 0, level: null, done: false });

  function cancelTimer() {
    clearTimeout(state.timer);
    state.timer = null;
    state.runId++; // 即使旧回调已进入任务队列，它也不能继续修改页面。
  }
  function clearError() {
    ui.error.hidden = true;
    ui.error.textContent = "";
    ui.input.removeAttribute("aria-invalid");
  }
  function showError(error) {
    ui.error.textContent = error.message;
    ui.error.hidden = false;
    ui.input.setAttribute("aria-invalid", "true");
  }
  function updateControls() {
    for (const key of ["input", "create", "default", "start"]) ui[key].disabled = busy();
    // 遍历选择器保持可用；切换会主动取消旧演示，而非并发开启另一任务。
    ui.pause.disabled = !busy();
    ui.pause.textContent = state.status === "paused" ? "▶ 继续" : "Ⅱ 暂停";
    ui.step.disabled = state.status === "running";
    ui.start.textContent = state.status === "completed" ? "▶ 再次演示" : "▶ 开始演示";
    ui.status.dataset.status = state.status;
    ui.status.textContent = { idle: "待开始", running: "演示中", paused: "已暂停", completed: "已完成" }[state.status];
  }

  function showCode() {
    const code = core.CODES[state.operation];
    ui["code-title"].textContent = `C++ · ${code.title}`;
    get("bt-current-operation").textContent = code.title;
    get("bt-order-hint").textContent = orders[state.operation];
    ui.code.replaceChildren(...code.lines.map((text, index) => {
      const line = document.createElement("span");
      line.className = "bt-code-line";
      line.dataset.line = index + 1;
      line.textContent = text || " ";
      return line;
    }));
    ui["code-scroll"].scrollTop = 0;
    ui.principle.textContent = code.principle;
    ui.complexity.textContent = code.complexity;
    const bfs = state.operation === "levelorder";
    get("bt-result-hint").textContent = `只有 visit(${bfs ? "curr" : "root"}) 才加入结果`;
    get("bt-memory-title").textContent = bfs ? "BFS 队列" : "递归调用栈";
    get("bt-memory-hint").textContent = bfs ? "先进先出。出队和访问是两步，孩子按左、右的顺序加入队尾。" : "栈顶在上方。高亮帧是当前执行的函数，其余帧正在等待子调用。";
    ui.stack.hidden = bfs;
    get("bt-queue-panel").hidden = !bfs;
    get("bt-depth-stat").hidden = bfs;
    get("bt-depth-note").hidden = bfs;
    get("bt-level-stat").hidden = !bfs;
  }

  const svgNS = "http://www.w3.org/2000/svg";
  function svgElement(tag, attrs, text) {
    const element = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function layoutTree(model) {
    // 中序编号只用于横坐标：整个左子树必在左，整个右子树必在右。
    // 播放过程只读固定坐标，不会因节点状态变化而重新排列树。
    const positions = {};
    const width = Math.max(560, model.count * 90 + 80);
    const offset = (width - Math.max(0, model.count - 1) * 90) / 2;
    let rank = 0;
    function place(id, depth) {
      if (id === null) return;
      const node = model.nodes[id];
      place(node.left, depth + 1);
      positions[id] = { x: offset + rank++ * 90, y: 58 + (depth - 1) * 124 };
      place(node.right, depth + 1);
    }
    place(model.root, 1);
    return { positions, width, height: Math.max(330, model.depth * 124 + 65) };
  }

  function renderTree(frame) {
    const { positions, width, height } = layoutTree(state.model);
    const svg = ui.canvas;
    svg.replaceChildren();
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const defs = svgElement("defs", {});
    for (const [name, color] of [["call", "#b37c1b"], ["return", "#855ea7"]]) {
      const marker = svgElement("marker", { id: `bt-arrow-${name}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto" });
      marker.append(svgElement("path", { d: "M0,0 L10,5 L0,10 z", fill: color }));
      defs.append(marker);
    }
    svg.append(defs);
    for (const node of Object.values(state.model.nodes)) {
      for (const side of ["left", "right"]) {
        const child = node[side];
        if (child === null) continue;
        const from = positions[node.id], to = positions[child];
        const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy);
        const start = { x: from.x + dx / distance * 29, y: from.y + dy / distance * 29 };
        const end = { x: to.x - dx / distance * 29, y: to.y - dy / distance * 29 };
        const active = frame.activeEdge?.from === node.id && frame.activeEdge.to === child;
        const returning = active && frame.activeEdge.direction === "return";
        const onPath = frame.pathIds.includes(node.id) && frame.pathIds.includes(child);
        const edge = svgElement("path", { class: `bt-edge${onPath ? " on-path" : ""}${active ? " active" : ""}${returning ? " returning" : ""}`, "data-from": node.id, "data-to": child, "data-side": side,
          d: returning ? `M${end.x},${end.y} L${start.x},${start.y}` : `M${start.x},${start.y} L${end.x},${end.y}` });
        if (active) edge.setAttribute("marker-end", `url(#bt-arrow-${returning ? "return" : "call"})`);
        svg.append(edge);
        svg.append(svgElement("text", { class: "bt-edge-label", x: (from.x + to.x) / 2 + (side === "left" ? -9 : 9), y: (from.y + to.y) / 2, "text-anchor": side === "left" ? "end" : "start" }, `${side === "left" ? "左" : "右"}${active ? (state.operation === "levelorder" ? " · 入队" : returning ? " · 返回" : " · 调用") : ""}`));
      }
    }
    for (const node of Object.values(state.model.nodes)) {
      const flags = [];
      if (frame.visitedIds.includes(node.id)) flags.push("visited");
      if (frame.completedIds.includes(node.id)) flags.push("completed");
      if (frame.pathIds.includes(node.id)) flags.push("path");
      if (frame.nodeId === node.id) flags.push("current");
      const primary = flags.at(-1) || "default";
      const descriptions = flags.map((flag) => ({ visited: "✓已访问", completed: "✓✓完成", path: "路径", current: "▶当前" })[flag]);
      const p = positions[node.id];
      const group = svgElement("g", { class: "bt-node", transform: `translate(${p.x} ${p.y})`, "data-node-id": node.id, "data-value": node.val, "data-state": primary, "data-states": flags.join(" "), role: "img", "aria-label": `${label(node.id)}，${descriptions.join("，") || "待处理"}` });
      group.append(svgElement("title", {}, `${label(node.id)}；左孩子 ${node.left || "nullptr"}，右孩子 ${node.right || "nullptr"}`));
      group.append(svgElement("circle", { r: 27 }));
      group.append(svgElement("text", { class: "bt-node-value", y: -1 }, node.val));
      group.append(svgElement("text", { class: "bt-node-id", y: 41 }, node.id));
      // 完成与已访问可以同时存在；短标签不挤占相邻节点空间，完整状态见可访问标签。
      const status = flags.includes("current") ? `▶当前${flags.includes("visited") ? " · ✓" : ""}` : flags.includes("completed") ? "✓✓ 已完成" : flags.includes("path") ? `┆路径${flags.includes("visited") ? " · ✓" : ""}` : flags.includes("visited") ? "✓ 已访问" : "待处理";
      group.append(svgElement("text", { class: "bt-node-state", y: 56 }, status));
      svg.append(group);
    }
    const top = frame.stack.at(-1);
    if (top && top.nodeId === null) {
      const parent = top.parentId ? positions[top.parentId] : null;
      const x = parent ? parent.x + (top.side === "left" ? -43 : 43) : width / 2;
      const y = parent ? parent.y + 90 : 130;
      const group = svgElement("g", { class: "bt-null-call", transform: `translate(${x} ${y})` });
      if (parent) svg.append(svgElement("path", { class: "bt-edge active", "stroke-dasharray": "4 3", d: `M${parent.x},${parent.y + 29} L${x},${y - 15}` }));
      group.append(svgElement("rect", { x: -36, y: -15, width: 72, height: 28, rx: 5 }));
      group.append(svgElement("text", { y: 4 }, "nullptr"));
      svg.append(group);
    } else if (state.model.root === null) {
      svg.append(svgElement("text", { class: "bt-empty", x: width / 2, y: 140 }, "root = nullptr · 空树"));
    }
    ui.count.textContent = state.model.count;
    ui["tree-depth"].textContent = state.model.depth;
    ui.path.textContent = state.operation === "levelorder" ? "队列决定下一次处理的节点；连线表示原始父子关系。" : `调用路径：${frame.stack.map((item) => label(item.nodeId)).join(" → ") || "—"}`;
  }

  function textElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }
  function renderMemory(frame) {
    ui.stack.replaceChildren(...[...frame.stack].reverse().map((item, index) => {
      const card = textElement("div", `bt-frame${index === 0 ? " active" : ""}`, "");
      Object.assign(card.dataset, { frameId: item.id, nodeId: item.nodeId ?? "null", depth: frame.stack.length - index });
      if (index === 0) card.append(textElement("p", "bt-frame-position", "栈顶 · 当前执行"));
      card.append(textElement("strong", "", `${state.operation}(${item.nodeId === null ? "nullptr" : state.model.nodes[item.nodeId].val})${item.nodeId === null ? "" : ` [${item.nodeId}]`}`));
      card.append(textElement("small", "", phases[item.phase] || item.phase));
      return card;
    }));
    if (!frame.stack.length) ui.stack.append(textElement("div", "bt-memory-empty", "栈空 · 没有正在执行的递归函数"));
    // 新栈顶始终可见；滚动只发生在栈面板内部，不带动整个页面。
    ui.stack.scrollTop = 0;
    ui.queue.replaceChildren(...frame.queue.map((item, index) => {
      const card = textElement("div", "bt-queue-item", state.model.nodes[item.nodeId].val);
      Object.assign(card.dataset, { nodeId: item.nodeId, level: item.level });
      card.append(textElement("small", "", `${item.nodeId} · 第${item.level}层`));
      card.append(textElement("small", "", `${index === 0 ? "队头" : ""}${index === 0 && frame.queue.length === 1 ? " / " : ""}${index === frame.queue.length - 1 ? "队尾" : ""}`));
      return card;
    }));
    if (!frame.queue.length) ui.queue.append(textElement("div", "bt-memory-empty", "队列为空"));
    ui.current.textContent = frame.nodeId === null && !frame.stack.length ? "—" : label(frame.nodeId);
    ui["recursion-depth"].textContent = frame.stack.length;
    ui.level.textContent = frame.level ?? "—";
  }

  function renderFrame() {
    const frame = state.frame || emptyFrame();
    renderTree(frame);
    renderMemory(frame);
    ui.result.replaceChildren();
    frame.visitedIds.forEach((id, index) => {
      if (index) ui.result.append(textElement("span", "bt-result-arrow", "→"));
      const item = textElement("span", "bt-result-item", state.model.nodes[id].val);
      Object.assign(item.dataset, { nodeId: id, value: state.model.nodes[id].val });
      item.append(textElement("small", "", id));
      ui.result.append(item);
    });
    if (!frame.visitedIds.length) ui.result.textContent = frame.done ? "空结果 []" : "尚未访问任何节点";
    ui["step-count"].textContent = state.count;
    ui.description.textContent = frame.message || "点击「下一步」，先观察函数进入，再观察访问发生的时机。";
    const code = core.CODES[state.operation];
    ui["current-code"].textContent = frame.line ? code.lines[frame.line - 1].trim() : "—";
    for (const line of ui.code.children) {
      const active = Number(line.dataset.line) === frame.line;
      line.classList.toggle("active", active);
      if (active) line.setAttribute("aria-current", "step"); else line.removeAttribute("aria-current");
      if (active) {
        const container = ui["code-scroll"];
        if (line.offsetTop < container.scrollTop || line.offsetTop + line.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = Math.max(0, line.offsetTop - 60);
      }
    }
    updateControls();
  }

  function resetTraversal() {
    cancelTimer();
    if (state.before) state.model = core.cloneTree(state.before);
    state.frame = null;
    state.iterator = null;
    state.count = 0;
    state.status = "idle";
    clearError();
    renderFrame();
  }
  function prepareTraversal(status) {
    cancelTimer();
    clearError();
    state.before = core.cloneTree(state.model);
    state.iterator = core.traversalSteps(state.model, state.operation);
    state.count = 0;
    state.frame = null;
    state.status = status;
  }
  function advanceOneStep() {
    if (!busy()) return;
    try {
      const next = state.iterator.next();
      if (next.done) throw new Error("遍历未产生结束步骤。");
      state.frame = next.value;
      state.count++;
      if (state.frame.done) {
        cancelTimer();
        state.status = "completed";
        state.iterator = null;
      }
      // 一份快照一次更新全部视图，栈、代码与结果不会走到不同步骤。
      renderFrame();
    } catch (error) {
      resetTraversal();
      showError(new Error(`演示已停止并恢复原树：${error.message}`));
    }
  }
  function scheduleNext() {
    const token = state.runId;
    state.timer = setTimeout(() => {
      if (token !== state.runId || state.status !== "running") return;
      state.timer = null;
      advanceOneStep();
      if (state.status === "running") scheduleNext();
    }, delay());
  }

  ui.start.addEventListener("click", () => {
    if (busy()) return;
    prepareTraversal("running");
    advanceOneStep();
    if (state.status === "running") scheduleNext();
  });
  ui.step.addEventListener("click", () => {
    if (state.status === "running") return;
    if (state.status !== "paused") prepareTraversal("paused");
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
    updateControls(); // 暂停只更新控件，不推进生成器或重绘教学内容。
  });
  ui.reset.addEventListener("click", resetTraversal);
  ui.speed.addEventListener("input", () => {
    ui["speed-output"].textContent = `每步 ${delay()} 毫秒`;
    ui.speed.setAttribute("aria-valuetext", ui["speed-output"].textContent);
  });
  function replaceTree(text) {
    if (busy()) return;
    try {
      const model = core.parseTree(text); // 先完整校验；失败不改变当前有效树与教学进度。
      state.model = model;
      state.before = null;
      resetTraversal();
      ui.input.value = text.trim();
      ui.scroll.scrollLeft = 0;
      ui.scroll.scrollTop = 0;
    } catch (error) { showError(error); }
  }
  get("bt-create-form").addEventListener("submit", (event) => {
    event.preventDefault();
    replaceTree(ui.input.value);
  });
  ui.default.addEventListener("click", () => replaceTree(core.DEFAULT_INPUT));
  ui.operation.addEventListener("change", () => {
    state.operation = ui.operation.value;
    showCode();
    resetTraversal();
  });
  window.addEventListener("learning:view-change", (event) => {
    if (event.detail !== "tree" && busy()) resetTraversal();
  });
  window.addEventListener("pagehide", () => { if (busy()) resetTraversal(); });
  showCode();
  resetTraversal();
})();
