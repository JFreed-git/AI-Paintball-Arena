const fs = require('fs');
const path = require('path');

/**
 * Watches .agent-hub/ for file changes: new tasks, task results, plan updates.
 * Uses fs.watch with debouncing.
 */
class FileWatcher {
  constructor(hubDir) {
    this.hubDir = hubDir;
    this.tasksDir = path.join(hubDir, 'tasks');
    this.channelsDir = path.join(hubDir, 'channels');
    this._watchers = [];
    this._listeners = new Map(); // eventType → [callback]
    this._debounceTimers = new Map();
  }

  start() {
    // Ensure directories exist
    if (!fs.existsSync(this.tasksDir)) {
      fs.mkdirSync(this.tasksDir, { recursive: true });
    }

    // Watch tasks directory for new task files and result files
    try {
      const tasksWatcher = fs.watch(this.tasksDir, (eventType, filename) => {
        if (!filename) return;
        this._debounce(`tasks:${filename}`, () => {
          if (/^task-\d+\.md$/.test(filename)) {
            this._emit('new_task', { filename, path: path.join(this.tasksDir, filename) });
          } else if (/^task-\d+-result\.md$/.test(filename)) {
            const id = filename.match(/task-(\d+)-result\.md/)[1];
            this._emit('task_result', { taskId: id, filename, path: path.join(this.tasksDir, filename) });
          } else if (/^task-\d+-lock$/.test(filename)) {
            const id = filename.match(/task-(\d+)-lock/)[1];
            this._emit('task_claimed', { taskId: id, lockDir: path.join(this.tasksDir, filename) });
          }
        }, 300);
      });
      this._watchers.push(tasksWatcher);
    } catch (e) {
      console.error('Failed to watch tasks directory:', e.message);
    }

    // Watch for plan.md changes
    const planPath = path.join(this.hubDir, 'plan.md');
    this._watchFile(planPath, () => {
      this._emit('plan_update', { path: planPath });
    });

    // Watch for pinned.md changes
    const pinnedPath = path.join(this.hubDir, 'pinned.md');
    this._watchFile(pinnedPath, () => {
      this._emit('pinned_update', { path: pinnedPath });
    });

    // Watch for vision.md changes
    const visionPath = path.join(this.hubDir, 'vision.md');
    this._watchFile(visionPath, () => {
      this._emit('vision_update', { path: visionPath });
    });

    // Watch channels/ directory for JSONL file changes
    if (!fs.existsSync(this.channelsDir)) {
      fs.mkdirSync(this.channelsDir, { recursive: true });
    }
    try {
      const channelsWatcher = fs.watch(this.channelsDir, (eventType, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return;
        const role = filename.replace('.jsonl', '');
        this._debounce(`channels:${filename}`, () => {
          this._emit('channel_update', { role, filename, path: path.join(this.channelsDir, filename) });
        }, 300);
      });
      this._watchers.push(channelsWatcher);
    } catch (e) {
      console.error('Failed to watch channels directory:', e.message);
    }
  }

  _watchFile(filePath, callback) {
    // Watch the parent directory for the specific file
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath);

    try {
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (filename === basename) {
          this._debounce(filePath, callback, 300);
        }
      });
      this._watchers.push(watcher);
    } catch (e) {
      // Directory may not exist yet — that's ok
    }
  }

  stop() {
    for (const w of this._watchers) {
      try { w.close(); } catch (e) { /* ignore */ }
    }
    this._watchers = [];
    for (const timer of this._debounceTimers.values()) {
      clearTimeout(timer);
    }
    this._debounceTimers.clear();
  }

  /**
   * Subscribe to file events.
   * Types: 'new_task', 'task_result', 'plan_update', 'pinned_update', 'vision_update'
   */
  on(eventType, callback) {
    if (!this._listeners.has(eventType)) {
      this._listeners.set(eventType, []);
    }
    this._listeners.get(eventType).push(callback);
  }

  _emit(eventType, data) {
    const callbacks = this._listeners.get(eventType) || [];
    for (const fn of callbacks) {
      try { fn(data); } catch (e) { console.error(`FileWatcher event error (${eventType}):`, e); }
    }
  }

  _debounce(key, fn, ms) {
    if (this._debounceTimers.has(key)) {
      clearTimeout(this._debounceTimers.get(key));
    }
    this._debounceTimers.set(key, setTimeout(() => {
      this._debounceTimers.delete(key);
      fn();
    }, ms));
  }
}

module.exports = FileWatcher;
