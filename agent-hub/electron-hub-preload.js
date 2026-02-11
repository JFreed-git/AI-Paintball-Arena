const { contextBridge, clipboard } = require('electron');
const path = require('path');
const Orchestrator = require('./lib/orchestrator');

const PROJECT_ROOT = path.resolve(__dirname, '..');
let orchestrator = null;
const eventCallbacks = new Map(); // type -> [callback]

function getOrchestrator() {
  if (!orchestrator) {
    orchestrator = new Orchestrator(PROJECT_ROOT);
    orchestrator.init();

    // Route all orchestrator events to registered callbacks
    orchestrator.onEvent((type, data) => {
      const callbacks = eventCallbacks.get(type) || [];
      for (const fn of callbacks) {
        try { fn(data); } catch (e) { console.error('Event callback error:', e); }
      }
      // Wildcard listeners
      const wildcards = eventCallbacks.get('*') || [];
      for (const fn of wildcards) {
        try { fn(type, data); } catch (e) { console.error('Wildcard callback error:', e); }
      }
    });
  }
  return orchestrator;
}

contextBridge.exposeInMainWorld('hubAPI', {
  startWatching() {
    const orch = getOrchestrator();
    orch.startWatching();
  },

  stopWatching() {
    if (orchestrator) orchestrator.stopWatching();
  },

  getAgents() {
    return getOrchestrator().getAgents();
  },

  getMessages() {
    return getOrchestrator().getMessages();
  },

  getTasks() {
    return getOrchestrator().getTasks();
  },

  getPlan() {
    return getOrchestrator().getPlan();
  },

  getPinned() {
    return getOrchestrator().getPinned();
  },

  setPinned(text) {
    getOrchestrator().setPinned(text);
  },

  addPinned(text) {
    getOrchestrator().addPinned(text);
  },

  getRolePrompt(role) {
    return getOrchestrator().getRolePrompt(role);
  },

  reset() {
    getOrchestrator().reset();
  },

  addWorkerSlot() {
    getOrchestrator().addWorkerSlot();
  },

  writeInbox(role, text) {
    getOrchestrator().writeInbox(role, text);
  },

  readInbox(role) {
    return getOrchestrator().readInbox(role);
  },

  copyToClipboard(text) {
    clipboard.writeText(text);
  },

  onEvent(type, callback) {
    if (!eventCallbacks.has(type)) {
      eventCallbacks.set(type, []);
    }
    eventCallbacks.get(type).push(callback);
  },

  removeAllListeners() {
    eventCallbacks.clear();
  }
});
