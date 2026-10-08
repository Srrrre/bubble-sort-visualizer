"use strict";

// 导航只负责切换模块；各播放器收到事件后自行取消未完成任务。
(() => {
  const modules = {
    bubble: { section: "bubble-view", hash: "bubble-sort", title: "冒泡排序" },
    list: { section: "linked-list-view", hash: "linked-list", title: "单链表" },
    tree: { section: "binary-tree-view", hash: "binary-tree", title: "二叉树" }
  };
  let active = null;
  function switchView(view, updateHash = false) {
    if (view === active) return;
    window.dispatchEvent(new CustomEvent("learning:view-change", { detail: view }));
    active = view;
    for (const [name, module] of Object.entries(modules)) {
      document.getElementById(module.section).hidden = name !== view;
      document.getElementById(`nav-${name}`).setAttribute("aria-pressed", String(name === view));
    }
    document.title = `${modules[view].title}可视化 · 算法实验室`;
    if (updateHash) location.hash = modules[view].hash;
  }
  function fromHash() {
    return Object.keys(modules).find((name) => `#${modules[name].hash}` === location.hash) || "bubble";
  }
  for (const name of Object.keys(modules)) {
    document.getElementById(`nav-${name}`).addEventListener("click", () => switchView(name, true));
  }
  window.addEventListener("hashchange", () => switchView(fromHash()));
  switchView(fromHash());
})();
