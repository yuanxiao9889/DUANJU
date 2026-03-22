const { entrypoints } = require("uxp");

const _id = Symbol("_id");
const _root = Symbol("_root");
const _attachment = Symbol("_attachment");

class PanelController {
  constructor({ id } = {}) {
    this[_id] = null;
    this[_root] = null;
    this[_attachment] = null;
    
    this[_id] = id;
    
    ["create", "show", "hide", "destroy"].forEach(fn => this[fn] = this[fn].bind(this));
  }
  
  create() {
    this[_root] = document.createElement("div");
    this[_root].style.height = "100vh";
    this[_root].style.overflowY = "auto";
    this[_root].style.overflowX = "hidden";
    
    return this[_root];
  }
  
  show(event) {
    if (!this[_root]) this.create();
    this[_attachment] = event;
    this[_attachment].appendChild(this[_root]);
    
    if (globalThis.storyboardCopilot) {
      globalThis.storyboardCopilot.renderPanel(this[_root]);
      globalThis.storyboardCopilot.startAutoRefresh();
    }
  }
  
  hide() {
    if (this[_attachment] && this[_root]) {
      this[_attachment].removeChild(this[_root]);
      this[_attachment] = null;
    }
    
    if (globalThis.storyboardCopilot) {
      globalThis.storyboardCopilot.stopAutoRefresh();
    }
  }
  
  destroy() {
    if (globalThis.storyboardCopilot) {
      globalThis.storyboardCopilot.stopAll();
    }
  }
}

entrypoints.setup({
  plugin: {
    create(plugin) {
      console.log("Storyboard Copilot plugin created");
    },
    destroy() {
      console.log("Storyboard Copilot plugin destroyed");
    }
  },
  panels: {
    'mainPanel': new PanelController({ id: "mainPanel" })
  }
});
