const fs = require('fs');
const path = require('path');

/**
 * Manages tasks as markdown files in .agent-hub/tasks/.
 * Statuses: pending → assigned → working → completed | failed
 */
class TaskManager {
  constructor(hubDir) {
    this.tasksDir = path.join(hubDir, 'tasks');
    this.tasks = new Map(); // id → { id, title, status, assignee, filePath, resultPath, dependencies }
    this._listeners = [];
  }

  init() {
    if (!fs.existsSync(this.tasksDir)) {
      fs.mkdirSync(this.tasksDir, { recursive: true });
    }
    this._scanTasks();
  }

  _scanTasks() {
    const entries = fs.readdirSync(this.tasksDir);
    const files = entries.filter(f => /^task-\d+\.md$/.test(f));
    for (const file of files) {
      const id = file.match(/task-(\d+)\.md/)[1];
      if (!this.tasks.has(id)) {
        this._loadTask(id);
      }
    }
    // Scan for results
    const results = entries.filter(f => /^task-\d+-result\.md$/.test(f));
    for (const file of results) {
      const id = file.match(/task-(\d+)-result\.md/)[1];
      if (this.tasks.has(id) && this.tasks.get(id).status !== 'completed') {
        this._markCompleted(id);
      }
    }
    // Scan for lock directories (atomic claiming)
    const locks = entries.filter(f => /^task-\d+-lock$/.test(f));
    for (const lockDir of locks) {
      const id = lockDir.match(/task-(\d+)-lock/)[1];
      const task = this.tasks.get(id);
      if (task && task.status !== 'completed') {
        task.status = 'working';
        const claimedByPath = path.join(this.tasksDir, lockDir, 'claimed-by.txt');
        try {
          task.assignee = fs.readFileSync(claimedByPath, 'utf-8').trim();
        } catch (e) { /* no claimed-by file yet */ }
      }
    }
  }

  _loadTask(id) {
    const filePath = path.join(this.tasksDir, `task-${id}.md`);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Parse title from first heading
    const titleMatch = content.match(/^#\s+Task\s+\d+:\s*(.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : `Task ${id}`;

    // Parse dependencies
    const depMatch = content.match(/##\s+Dependencies\s*\n([\s\S]*?)(?=\n##|\n$|$)/i);
    const dependencies = [];
    if (depMatch) {
      const depText = depMatch[1].trim().toLowerCase();
      if (depText !== 'none') {
        const taskRefs = depText.match(/task[- ]?(\d+)/gi) || [];
        for (const ref of taskRefs) {
          const depId = ref.match(/(\d+)/)[1];
          dependencies.push(depId.padStart(3, '0'));
        }
      }
    }

    const resultPath = path.join(this.tasksDir, `task-${id}-result.md`);
    const hasResult = fs.existsSync(resultPath);
    const lockDir = path.join(this.tasksDir, `task-${id}-lock`);
    const hasLock = fs.existsSync(lockDir);

    // Parse ## Assigned To section
    const assignedMatch = content.match(/##\s+Assigned\s+To\s*\n\s*(.+)/i);
    const assignedTo = assignedMatch ? assignedMatch[1].trim() : null;

    // Read claimed-by from lock dir if it exists
    let assignee = null;
    if (hasLock) {
      const claimedByPath = path.join(lockDir, 'claimed-by.txt');
      try { assignee = fs.readFileSync(claimedByPath, 'utf-8').trim(); } catch (e) { /* */ }
    }

    const task = {
      id,
      title,
      status: hasResult ? 'completed' : hasLock ? 'working' : 'pending',
      assignee,
      assignedTo,
      filePath,
      resultPath,
      dependencies,
      content
    };

    this.tasks.set(id, task);
    return task;
  }

  _markCompleted(id) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'completed';
      task.assignee = null;
      this._emit('task_update', task);
    }
  }

  /**
   * Re-scan tasks directory for new/changed files.
   */
  refresh() {
    this._scanTasks();
    return this.getAll();
  }

  /**
   * Detect new task files and return them.
   */
  detectNewTasks() {
    const before = new Set(this.tasks.keys());
    this._scanTasks();
    const newTasks = [];
    for (const [id, task] of this.tasks) {
      if (!before.has(id)) newTasks.push(task);
    }
    return newTasks;
  }

  /**
   * Detect new lock directories and update task statuses.
   */
  detectNewLocks() {
    const changed = [];
    try {
      const entries = fs.readdirSync(this.tasksDir);
      const locks = entries.filter(f => /^task-\d+-lock$/.test(f));
      for (const lockDir of locks) {
        const id = lockDir.match(/task-(\d+)-lock/)[1];
        const task = this.tasks.get(id);
        if (task && task.status !== 'completed' && task.status !== 'working') {
          task.status = 'working';
          const claimedByPath = path.join(this.tasksDir, lockDir, 'claimed-by.txt');
          try { task.assignee = fs.readFileSync(claimedByPath, 'utf-8').trim(); } catch (e) { /* */ }
          changed.push(task);
        }
      }
    } catch (e) { /* */ }
    return changed;
  }

  /**
   * Detect new result files and return completed tasks.
   */
  detectNewResults() {
    const completed = [];
    for (const [id, task] of this.tasks) {
      if (task.status !== 'completed') {
        const resultPath = path.join(this.tasksDir, `task-${id}-result.md`);
        if (fs.existsSync(resultPath)) {
          this._markCompleted(id);
          completed.push(task);
        }
      }
    }
    return completed;
  }

  /**
   * Get all tasks as an array.
   */
  getAll() {
    return Array.from(this.tasks.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Get a specific task.
   */
  get(id) {
    return this.tasks.get(id) || null;
  }

  /**
   * Assign a task to a worker.
   */
  assign(id, workerName) {
    const task = this.tasks.get(id);
    if (!task) return null;
    task.status = 'assigned';
    task.assignee = workerName;
    this._emit('task_update', task);
    return task;
  }

  /**
   * Mark task as actively being worked on.
   */
  setWorking(id) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'working';
    this._emit('task_update', task);
  }

  /**
   * Mark task as failed.
   */
  setFailed(id, reason) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'failed';
    task.assignee = null;
    task.failReason = reason;
    this._emit('task_update', task);
  }

  /**
   * Get next assignable task (pending, no unmet dependencies).
   */
  getNextPending() {
    for (const task of this.getAll()) {
      if (task.status !== 'pending') continue;
      const depsOk = task.dependencies.every(depId => {
        const dep = this.tasks.get(depId);
        return dep && dep.status === 'completed';
      });
      if (depsOk) return task;
    }
    return null;
  }

  /**
   * Check if all tasks are completed.
   */
  allCompleted() {
    if (this.tasks.size === 0) return false;
    return this.getAll().every(t => t.status === 'completed');
  }

  /**
   * Format task statuses for Leader prompt.
   */
  formatForPrompt() {
    const tasks = this.getAll();
    if (tasks.length === 0) return 'No tasks created yet.';
    return tasks.map(t => {
      let line = `- Task ${t.id}: "${t.title}" — ${t.status}`;
      if (t.assignee) line += ` (claimed by ${t.assignee})`;
      if (t.assignedTo) line += ` [assigned to ${t.assignedTo}]`;
      if (t.status === 'completed') {
        // Include brief result summary
        try {
          const result = fs.readFileSync(t.resultPath, 'utf-8');
          const statusLine = result.match(/##\s+Status:\s*(.+)/i);
          if (statusLine) line += ` [${statusLine[1].trim()}]`;
        } catch (e) { /* no result file */ }
      }
      return line;
    }).join('\n');
  }

  /**
   * Read a task file's full content.
   */
  readTaskContent(id) {
    const task = this.tasks.get(id);
    if (!task) return null;
    try {
      return fs.readFileSync(task.filePath, 'utf-8');
    } catch (e) {
      return null;
    }
  }

  /**
   * Read a task result file.
   */
  readTaskResult(id) {
    const resultPath = path.join(this.tasksDir, `task-${id}-result.md`);
    try {
      return fs.readFileSync(resultPath, 'utf-8');
    } catch (e) {
      return null;
    }
  }

  _emit(type, data) {
    for (const fn of this._listeners) fn(type, data);
  }

  onEvent(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(f => f !== fn); };
  }
}

module.exports = TaskManager;
