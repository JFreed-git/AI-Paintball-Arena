const fs = require('fs');
const path = require('path');

class MessageStore {
  constructor(hubDir) {
    this.filePath = path.join(hubDir, 'messages.jsonl');
    this.messages = [];
    this._nextId = 1;
    this._listeners = [];
  }

  init() {
    // Load existing messages from disk
    if (fs.existsSync(this.filePath)) {
      const lines = fs.readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          this.messages.push(msg);
          if (msg.id >= this._nextId) this._nextId = msg.id + 1;
        } catch (e) { /* skip malformed lines */ }
      }
    }
  }

  /**
   * Add a message.
   * @param {object} opts
   * @param {string} opts.channel - 'main' | 'speaker' | 'sub:<name>'
   * @param {string} opts.sender  - agent name or 'user'
   * @param {string} opts.type    - 'text' | 'tool_call' | 'tool_result' | 'status' | 'error'
   * @param {string} opts.content - message content
   * @param {object} [opts.meta]  - optional metadata (tool name, task id, etc.)
   * @returns {object} the stored message
   */
  add({ channel, sender, type, content, meta }) {
    const msg = {
      id: this._nextId++,
      ts: Date.now(),
      channel,
      sender,
      type: type || 'text',
      content,
      meta: meta || null
    };
    this.messages.push(msg);
    // Append to JSONL file
    try {
      fs.appendFileSync(this.filePath, JSON.stringify(msg) + '\n');
    } catch (e) { /* ignore write errors during shutdown */ }
    // Notify listeners
    for (const fn of this._listeners) fn(msg);
    return msg;
  }

  /**
   * Query messages by channel, optionally since a given ID.
   */
  query(channel, sinceId = 0) {
    return this.messages.filter(m => m.channel === channel && m.id > sinceId);
  }

  /**
   * Get recent messages for a channel (last N).
   */
  recent(channel, count = 20) {
    const channelMsgs = this.messages.filter(m => m.channel === channel);
    return channelMsgs.slice(-count);
  }

  /**
   * Get all messages for a sender.
   */
  bySender(sender) {
    return this.messages.filter(m => m.sender === sender);
  }

  /**
   * Subscribe to new messages.
   */
  onMessage(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(f => f !== fn); };
  }

  /**
   * Get all messages (for serialization to renderer).
   */
  getAll() {
    return this.messages;
  }

  /**
   * Format recent main chat messages for inclusion in agent prompts.
   */
  formatForPrompt(channel, count = 20) {
    const msgs = this.recent(channel, count);
    return msgs
      .filter(m => m.type === 'text' || m.type === 'status')
      .map(m => `[${m.sender}] ${m.content}`)
      .join('\n');
  }

  /**
   * Load messages from a channel JSONL file (e.g. .agent-hub/channels/speaker.jsonl).
   * Returns parsed entries as an array.
   */
  loadFromChannel(role, filePath) {
    const entries = [];
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          entries.push({
            role,
            ts: entry.ts,
            type: entry.type,
            content: entry.content
          });
        } catch (e) { /* skip malformed lines */ }
      }
    } catch (e) { /* file not found or read error */ }
    return entries;
  }
}

module.exports = MessageStore;
