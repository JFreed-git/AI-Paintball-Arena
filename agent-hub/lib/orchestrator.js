const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const MessageStore = require('./message-store');
const TaskManager = require('./task-manager');
const FileWatcher = require('./file-watcher');

/**
 * Terminal-attached orchestrator: no process spawning.
 * Initializes .agent-hub/ dirs, generates role instruction files,
 * watches channels/ for agent activity, and exposes state to the UI.
 */
class Orchestrator {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.hubDir = path.join(projectRoot, '.agent-hub');
    this.rolesDir = path.join(this.hubDir, 'roles');
    this.channelsDir = path.join(this.hubDir, 'channels');
    this.inboxDir = path.join(this.hubDir, 'inbox');

    this.messageStore = new MessageStore(this.hubDir);
    this.taskManager = new TaskManager(this.hubDir);
    this.fileWatcher = new FileWatcher(this.hubDir);

    this._eventListeners = [];
    this._channelMessages = []; // merged messages from all channels
    this._running = false;
    this.workerCount = 3; // default number of worker slots
  }

  /**
   * Initialize the hub: create directories, generate role files, load state.
   */
  init() {
    const dirs = [
      this.hubDir,
      path.join(this.hubDir, 'tasks'),
      this.rolesDir,
      this.channelsDir,
      this.inboxDir
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize default pinned file
    const pinnedPath = path.join(this.hubDir, 'pinned.md');
    if (!fs.existsSync(pinnedPath)) {
      fs.writeFileSync(pinnedPath, '# Pinned Context\n\nThis is the AI Paintball Arena project \u2014 a browser-based 3D FPS game using Three.js.\nSee CLAUDE.md for full project documentation.\n');
    }

    // Auto-detect current git branch and add to pinned.md if not present
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: this.projectRoot }).toString().trim();
      const pinnedContent = fs.readFileSync(pinnedPath, 'utf-8');
      if (!pinnedContent.includes('Hub Branch:')) {
        fs.appendFileSync(pinnedPath, `\nHub Branch: ${branch}\n`);
      }
    } catch (e) { /* not a git repo or git not available */ }

    this._generateRoleFiles();
    this.messageStore.init();
    this.taskManager.init();
    this._ingestChannels();
  }

  /**
   * Start watching files for changes.
   */
  startWatching() {
    if (this._running) return;
    this._running = true;

    this.fileWatcher.on('task_result', () => {
      const completed = this.taskManager.detectNewResults();
      if (completed.length > 0) this._emit('tasks_update', this.taskManager.getAll());
    });
    this.fileWatcher.on('new_task', () => {
      const newTasks = this.taskManager.detectNewTasks();
      if (newTasks.length > 0) this._emit('tasks_update', this.taskManager.getAll());
    });
    this.fileWatcher.on('task_claimed', () => {
      const changed = this.taskManager.detectNewLocks();
      if (changed.length > 0) this._emit('tasks_update', this.taskManager.getAll());
    });
    this.fileWatcher.on('plan_update', () => this._emit('plan_update', this._readFile('plan.md')));
    this.fileWatcher.on('pinned_update', () => this._emit('pinned_update', this._readFile('pinned.md')));
    this.fileWatcher.on('vision_update', () => this._emit('vision_update', this._readFile('vision.md')));
    this.fileWatcher.on('channel_update', (data) => {
      this._ingestChannels();
      this._emit('channel_update', { role: data.role });
      this._emit('agents_update', this.getAgents());
    });

    this.fileWatcher.start();
    this._emit('system_status', { running: true });
  }

  /**
   * Stop watching files.
   */
  stopWatching() {
    this._running = false;
    this.fileWatcher.stop();
    this._emit('system_status', { running: false });
  }

  /**
   * Get detected agents based on channel file activity.
   * An agent with a message in the last 5 minutes is "connected".
   */
  getAgents() {
    const slots = ['speaker', 'leader'];
    for (let i = 1; i <= this.workerCount; i++) slots.push(`worker-${i}`);

    const now = Date.now();
    const FIVE_MIN = 5 * 60 * 1000;

    return slots.map(slot => {
      const channelFile = path.join(this.channelsDir, `${slot}.jsonl`);
      let status = 'not_connected';
      let lastSeen = null;
      let lastMessage = null;

      if (fs.existsSync(channelFile)) {
        try {
          const content = fs.readFileSync(channelFile, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const entry = JSON.parse(lines[i]);
              if (!lastSeen) {
                lastSeen = entry.ts;
                lastMessage = entry;
              }
              break;
            } catch (e) { /* skip malformed */ }
          }

          if (lastSeen && (now - lastSeen) < FIVE_MIN) {
            status = 'connected';
          } else if (lastSeen) {
            status = 'idle';
          }
        } catch (e) { /* file read error */ }
      }

      // Display name: "Speaker", "Leader", "Worker-1", etc.
      const name = slot.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('-');
      const role = slot.startsWith('worker') ? 'worker' : slot;

      return { name, role, slot, status, lastSeen, lastMessage: lastMessage ? lastMessage.content : null };
    });
  }

  /**
   * Add a new worker slot, generate its role file, and notify UI.
   */
  addWorkerSlot() {
    this.workerCount++;
    this._generateWorkerFile(this.workerCount);
    this._emit('agents_update', this.getAgents());
  }

  /**
   * Get all channel messages merged and sorted by timestamp.
   */
  getMessages() {
    return this._channelMessages.slice();
  }

  getTasks() {
    return this.taskManager.getAll();
  }

  getPlan() {
    return this._readFile('plan.md');
  }

  getPinned() {
    return this._readFile('pinned.md');
  }

  setPinned(text) {
    const pinnedPath = path.join(this.hubDir, 'pinned.md');
    fs.writeFileSync(pinnedPath, text);
    this._emit('pinned_update', text);
  }

  addPinned(text) {
    const pinnedPath = path.join(this.hubDir, 'pinned.md');
    fs.appendFileSync(pinnedPath, `\n${text}\n`);
    this._emit('pinned_update', this._readFile('pinned.md'));
  }

  /**
   * Write a message to a role's inbox file.
   */
  writeInbox(role, text) {
    const inboxPath = path.join(this.inboxDir, `${role}.md`);
    fs.writeFileSync(inboxPath, text);
  }

  /**
   * Read a role's inbox file.
   */
  readInbox(role) {
    const inboxPath = path.join(this.inboxDir, `${role}.md`);
    try {
      return fs.readFileSync(inboxPath, 'utf-8');
    } catch (e) {
      return '';
    }
  }

  /**
   * Get the copyable prompt string for a given role.
   */
  getRolePrompt(role) {
    const roleFile = path.join(this.rolesDir, `${role}.md`);
    if (!fs.existsSync(roleFile)) return null;
    return `Read ${roleFile} and follow its instructions exactly.`;
  }

  /**
   * Reset the hub: clear all channel files and re-generate role files.
   */
  reset() {
    // Clear channel files
    try {
      const files = fs.readdirSync(this.channelsDir);
      for (const f of files) fs.unlinkSync(path.join(this.channelsDir, f));
    } catch (e) { /* ignore */ }

    // Clear old worker role files before regenerating
    try {
      const roleFiles = fs.readdirSync(this.rolesDir);
      for (const f of roleFiles) {
        if (f.startsWith('worker-')) fs.unlinkSync(path.join(this.rolesDir, f));
      }
    } catch (e) { /* ignore */ }

    // Clear lock directories from tasks/
    try {
      const taskEntries = fs.readdirSync(path.join(this.hubDir, 'tasks'));
      for (const f of taskEntries) {
        if (/^task-\d+-lock$/.test(f)) {
          fs.rmSync(path.join(this.hubDir, 'tasks', f), { recursive: true, force: true });
        }
      }
    } catch (e) { /* ignore */ }

    // Clear inbox files
    try {
      const inboxFiles = fs.readdirSync(this.inboxDir);
      for (const f of inboxFiles) fs.unlinkSync(path.join(this.inboxDir, f));
    } catch (e) { /* ignore */ }

    this._channelMessages = [];
    this._generateRoleFiles();
    this._emit('agents_update', this.getAgents());
    this._emit('channel_update', {});
  }

  // --- Event system ---

  onEvent(fn) {
    this._eventListeners.push(fn);
    return () => { this._eventListeners = this._eventListeners.filter(f => f !== fn); };
  }

  _emit(type, data) {
    for (const fn of this._eventListeners) {
      try { fn(type, data); } catch (e) { console.error('Orchestrator event error:', e); }
    }
  }

  // --- Internal ---

  _readFile(filename) {
    const filePath = path.join(this.hubDir, filename);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      return null;
    }
  }

  /**
   * Generate role instruction files into .agent-hub/roles/.
   */
  _generateRoleFiles() {
    const hubLog = (slot) =>
      `echo '{"ts":'$(date +%s000)',"type":"TYPE","content":"MESSAGE"}' >> ${path.join(this.channelsDir, slot + '.jsonl')}`;

    const speakerMd = `# Speaker Role

You are the **Speaker** agent in the Agent Hub for the AI Paintball Arena project.

## Project Location
\`${this.projectRoot}\`

## Your Job
Interview the user about their project vision. Ask targeted questions about what they want to build, priorities, constraints, and goals. Synthesize the conversation into a clear vision document.

## On Start
Post a \`connected\` message to the hub:
\`\`\`bash
echo '{"ts":'$(date +%s000)',"type":"connected","content":"Speaker connected"}' >> ${path.join(this.channelsDir, 'speaker.jsonl')}
\`\`\`

## During Interview
Post milestone updates as you progress:
\`\`\`bash
echo '{"ts":'$(date +%s000)',"type":"milestone","content":"YOUR_UPDATE_HERE"}' >> ${path.join(this.channelsDir, 'speaker.jsonl')}
\`\`\`

## When Done
1. Write the synthesized vision to \`${path.join(this.hubDir, 'vision.md')}\`
2. Post completion:
\`\`\`bash
echo '{"ts":'$(date +%s000)',"type":"milestone","content":"Vision complete"}' >> ${path.join(this.channelsDir, 'speaker.jsonl')}
\`\`\`

## Context
Read \`${path.join(this.hubDir, 'pinned.md')}\` for existing project context.
Read \`CLAUDE.md\` at the project root for architecture details.

## Hub Log Template
\`\`\`bash
${hubLog('speaker')}
\`\`\`
Replace TYPE with: connected, status, milestone, error
Replace MESSAGE with your update text.
`;

    const leaderMd = `# Leader Role

You are the **Leader** agent in the Agent Hub for the AI Paintball Arena project.

## Project Location
\`${this.projectRoot}\`

## Your Job
Read the project vision and pinned context, then create a plan and break it into tasks for Worker agents.

## On Start
Post a \`connected\` message to the hub:
\`\`\`bash
echo '{"ts":'$(date +%s000)',"type":"connected","content":"Leader connected"}' >> ${path.join(this.channelsDir, 'leader.jsonl')}
\`\`\`

## Workflow
1. Read \`${path.join(this.hubDir, 'vision.md')}\` for the project vision
2. Read \`${path.join(this.hubDir, 'pinned.md')}\` for pinned context (includes \`Hub Branch:\` — the shared integration branch)
3. Read \`CLAUDE.md\` at the project root for architecture details
4. Write your plan to \`${path.join(this.hubDir, 'plan.md')}\`
5. Create task files in \`${path.join(this.hubDir, 'tasks')}/\`:
   - Name format: \`task-NNN.md\` (e.g., task-001.md, task-002.md)
   - Each file should have: Title, Description, Relevant Files, Requirements, Dependencies, and optionally Assigned To
6. Post milestone when plan and tasks are created:
\`\`\`bash
echo '{"ts":'$(date +%s000)',"type":"milestone","content":"Plan created (N tasks)"}' >> ${path.join(this.channelsDir, 'leader.jsonl')}
\`\`\`

## Re-invocation
When the user asks you to review results:
1. Read task result files: \`${path.join(this.hubDir, 'tasks')}/task-NNN-result.md\`
2. Update the plan if needed
3. Create follow-up tasks if needed

## Task File Format
\`\`\`markdown
# Task NNN: Title

## Assigned To
Worker-N (or leave blank for any worker to claim)

## Description
What needs to be done.

## Relevant Files
- file1.js
- file2.js

## Requirements
- Requirement 1
- Requirement 2

## Dependencies
None (or: Task 001, Task 002)
\`\`\`

Use \`## Assigned To\` to route a task to a specific worker when it requires specialized context or must not conflict with another task. Leave it blank to let any available worker claim it.

Keep tasks focused and small (~30\u2013100 lines of changes each).

## Messaging Workers
You can send messages directly to workers via their inbox files:
\`\`\`bash
echo 'Your message to the worker here' > ${path.join(this.inboxDir, 'worker-N.md')}
\`\`\`
Replace \`worker-N\` with the target worker slot (e.g., \`worker-1\`, \`worker-2\`). Workers check their inbox before claiming tasks and after completing them.

## Hub Log Template
\`\`\`bash
${hubLog('leader')}
\`\`\`
Replace TYPE with: connected, status, milestone, error
Replace MESSAGE with your update text.
`;

    fs.writeFileSync(path.join(this.rolesDir, 'speaker.md'), speakerMd);
    fs.writeFileSync(path.join(this.rolesDir, 'leader.md'), leaderMd);

    // Generate numbered worker files
    for (let i = 1; i <= this.workerCount; i++) {
      this._generateWorkerFile(i);
    }
  }

  /**
   * Generate a single numbered worker role file.
   */
  _generateWorkerFile(n) {
    const slot = `worker-${n}`;
    const hubLog = `echo '{"ts":'$(date +%s000)',"type":"TYPE","content":"MESSAGE"}' >> ${path.join(this.channelsDir, slot + '.jsonl')}`;

    const tasksDir = path.join(this.hubDir, 'tasks');
    const md = `# Worker-${n} Role

You are **Worker-${n}**, a Worker agent in the Agent Hub for the AI Paintball Arena project.

## Project Location
\`${this.projectRoot}\`

## Your Job
Pick up a task from \`${tasksDir}/\`, do the work, and write a result file.

## On Start
Post a \`connected\` message to the hub:
\`\`\`bash
echo '{"ts":'$(date +%s000)',"type":"connected","content":"Worker-${n} connected"}' >> ${path.join(this.channelsDir, slot + '.jsonl')}
\`\`\`

## Inbox
Before claiming a task, check your inbox for messages from the Leader:
\`\`\`bash
cat ${path.join(this.inboxDir, slot + '.md')} 2>/dev/null
\`\`\`
After reading, clear it:
\`\`\`bash
> ${path.join(this.inboxDir, slot + '.md')}
\`\`\`
Also check your inbox after completing each task.

## Workflow
1. Read \`${path.join(this.hubDir, 'pinned.md')}\` for project context (includes \`Hub Branch:\`)
2. Read \`CLAUDE.md\` at the project root for architecture details
3. Check your inbox (see above)
4. Look at task files in \`${tasksDir}/\`

### Claiming a Task
Multiple workers run simultaneously. Use atomic \`mkdir\` to claim tasks (it fails if the directory already exists, preventing race conditions):

1. List all \`task-NNN.md\` files in the tasks directory
2. A task is **available** only if there is NO \`task-NNN-lock/\` directory AND NO \`task-NNN-result.md\` file
3. Check the task's \`## Assigned To\` section — if it names a different worker, **skip it**. If it names you or is blank, you may claim it.
4. Pick the lowest-numbered available task and attempt to claim it:
\`\`\`bash
mkdir ${tasksDir}/task-NNN-lock 2>/dev/null && echo "CLAIMED" || echo "TAKEN"
\`\`\`
5. If the output is "TAKEN", another worker claimed it first — skip and try the next task
6. If "CLAIMED", write your identity:
\`\`\`bash
echo "Worker-${n}" > ${tasksDir}/task-NNN-lock/claimed-by.txt
\`\`\`

### Git Branch Workflow
After claiming a task, create a feature branch to avoid file conflicts with other workers:
\`\`\`bash
git checkout -b worker-${n}/task-NNN
\`\`\`
Do all your work on this branch. When done:
\`\`\`bash
git add -A && git commit -m "Task NNN: description"
\`\`\`
Then merge back (read \`Hub Branch:\` from pinned.md for the branch name):
\`\`\`bash
git checkout <HUB_BRANCH> && git merge worker-${n}/task-NNN
\`\`\`
If merge conflicts occur: \`git merge --abort\`, set task Status to "Blocked", post an error to your channel, and move to the next task.

### Doing the Work
1. Post status update:
\`\`\`bash
echo '{"ts":'$(date +%s000)',"type":"status","content":"Working on task NNN"}' >> ${path.join(this.channelsDir, slot + '.jsonl')}
\`\`\`
2. Do the work (edit code, run commands, test)
3. Write the full result file:

\`\`\`markdown
# Result: Task NNN

## Status: Completed

## Worker: Worker-${n}

## Changes Made
- file.js: Description of changes

## Notes
Any relevant notes.
\`\`\`

Save to: \`${tasksDir}/task-NNN-result.md\`

4. Post completion:
\`\`\`bash
echo '{"ts":'$(date +%s000)',"type":"milestone","content":"Task NNN completed"}' >> ${path.join(this.channelsDir, slot + '.jsonl')}
\`\`\`

If blocked, set Status to "Blocked" in the result file and explain.

5. Check your inbox again, then look for the next available task.

## Hub Log Template
\`\`\`bash
${hubLog}
\`\`\`
Replace TYPE with: connected, status, milestone, error
Replace MESSAGE with your update text.
`;

    fs.writeFileSync(path.join(this.rolesDir, `${slot}.md`), md);
  }

  /**
   * Read all channel JSONL files, parse lines, merge into sorted list.
   */
  _ingestChannels() {
    this._channelMessages = [];
    try {
      const files = fs.readdirSync(this.channelsDir).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        const role = file.replace('.jsonl', '');
        const filePath = path.join(this.channelsDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              this._channelMessages.push({
                role,
                ts: entry.ts,
                type: entry.type,
                content: entry.content
              });
            } catch (e) { /* skip malformed */ }
          }
        } catch (e) { /* skip unreadable files */ }
      }
    } catch (e) { /* channels dir may not exist */ }

    this._channelMessages.sort((a, b) => a.ts - b.ts);
  }
}

module.exports = Orchestrator;
