/**
 * Puppeteer test for FFA and AI game modes.
 * Usage: /opt/homebrew/bin/node test-modes.js
 */

const puppeteer = require('puppeteer');

const URL = 'http://localhost:3000';
const RESULTS = [];
const PAGE_ERRORS = [];

function log(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

function pass(test, detail) {
  RESULTS.push({ test, status: 'PASS', detail });
  log(`  PASS: ${test}${detail ? ' — ' + detail : ''}`);
}

function fail(test, detail) {
  RESULTS.push({ test, status: 'FAIL', detail });
  log(`  FAIL: ${test}${detail ? ' — ' + detail : ''}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function testFFAMode(browser) {
  log('=== FFA MODE TEST ===');
  const page = await browser.newPage();
  const ffaErrors = [];

  page.on('pageerror', err => {
    const msg = err.message || String(err);
    ffaErrors.push(msg);
    log(`  PAGE_ERROR: ${msg}`);
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      ffaErrors.push(text);
      log(`  CONSOLE_ERROR: ${text}`);
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 15000 });
  log('Page loaded');

  // Wait for scripts to initialize
  await sleep(1000);

  // Start FFA host
  log('Starting FFA host...');
  const startResult = await page.evaluate(() => {
    try {
      window.startFFAHost('test-' + Date.now(), {
        killLimit: 5,
        aiConfigs: [
          { hero: 'marksman', difficulty: 'Easy' },
          { hero: 'brawler', difficulty: 'Easy' }
        ]
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  if (!startResult.ok) {
    fail('FFA: Start game', startResult.error);
    await page.close();
    return ffaErrors;
  }
  pass('FFA: Start game', 'startFFAHost called successfully');

  // Wait 3 seconds, then check state
  log('Waiting 3s for game initialization...');
  await sleep(3000);

  const stateCheck = await page.evaluate(() => {
    const state = window.getFFAState();
    if (!state) return { error: 'getFFAState() returned null' };

    const playerIds = Object.keys(state.players);
    const localId = state.localId;
    const localEntry = localId ? state.players[localId] : null;
    const botCount = playerIds.filter(id => id !== localId && state.players[id] && state.players[id].isAI).length;
    const allPlayerInfo = playerIds.map(id => ({
      id: id.substring(0, 12),
      isAI: !!(state.players[id] && state.players[id].isAI),
      heroId: state.players[id] && state.players[id].heroId,
      alive: state.players[id] && state.players[id].alive
    }));

    return {
      localId: localId ? localId.substring(0, 12) : null,
      localExists: !!localEntry,
      localEntity: localEntry && localEntry.entity ? true : false,
      playerCount: playerIds.length,
      botCount,
      lastTs: state.lastTs,
      roundActive: state.match ? state.match.roundActive : null,
      inputEnabled: state.inputEnabled,
      heroSelectOpen: !!window._heroSelectOpen,
      allPlayerInfo
    };
  });

  if (stateCheck.error) {
    fail('FFA: State check', stateCheck.error);
  } else {
    log('  State: ' + JSON.stringify(stateCheck, null, 2));

    if (stateCheck.localId) pass('FFA: Local player ID', stateCheck.localId);
    else fail('FFA: Local player ID', 'localId is null');

    if (stateCheck.localExists) pass('FFA: Local player entry', 'exists in state.players');
    else fail('FFA: Local player entry', 'not found in state.players');

    if (stateCheck.localEntity) pass('FFA: Local player entity', 'entity exists');
    else fail('FFA: Local player entity', 'entity missing (may be camera-based)');

    if (stateCheck.botCount >= 2) pass('FFA: Bot count', `${stateCheck.botCount} bots found`);
    else if (stateCheck.botCount >= 1) pass('FFA: Bot count', `${stateCheck.botCount} bot(s) found (expected 2)`);
    else fail('FFA: Bot count', `expected 2 bots, found ${stateCheck.botCount}`);

    if (stateCheck.lastTs > 0) pass('FFA: Tick running', `lastTs = ${stateCheck.lastTs.toFixed(0)}`);
    else fail('FFA: Tick running', `lastTs = ${stateCheck.lastTs}`);
  }

  // Handle hero selection if open
  const heroSelectOpen = await page.evaluate(() => !!window._heroSelectOpen);
  if (heroSelectOpen) {
    log('Hero select overlay is open — clicking first card...');
    const heroClicked = await page.evaluate(() => {
      const overlay = document.getElementById('heroSelectOverlay');
      if (!overlay) return { ok: false, error: 'no overlay element' };
      const card = overlay.querySelector('.hero-card');
      if (!card) return { ok: false, error: 'no hero cards' };
      card.click();
      return { ok: true, heroId: card.dataset.heroId };
    });
    if (heroClicked.ok) {
      pass('FFA: Hero select confirm', `selected hero: ${heroClicked.heroId}`);
    } else {
      fail('FFA: Hero select confirm', heroClicked.error);
    }
  } else {
    log('Hero select not open (may have auto-closed or timed out)');
    pass('FFA: Hero select', 'not blocking — already closed or bypassed');
  }

  // Wait for countdown to finish
  log('Waiting 5s for countdown...');
  await sleep(5000);

  const postCountdown = await page.evaluate(() => {
    const state = window.getFFAState();
    if (!state) return { error: 'state null' };
    return {
      roundActive: state.match ? state.match.roundActive : null,
      inputEnabled: state.inputEnabled,
      lastTs: state.lastTs,
      heroSelectOpen: !!window._heroSelectOpen
    };
  });

  if (postCountdown.error) {
    fail('FFA: Post-countdown state', postCountdown.error);
  } else {
    log('  Post-countdown: ' + JSON.stringify(postCountdown));
    if (postCountdown.roundActive) pass('FFA: Round active', 'true');
    else fail('FFA: Round active', `roundActive = ${postCountdown.roundActive}`);

    if (postCountdown.inputEnabled) pass('FFA: Input enabled', 'true');
    else fail('FFA: Input enabled', `inputEnabled = ${postCountdown.inputEnabled}`);
  }

  // Try shooting
  log('Attempting to shoot...');
  const shootResult = await page.evaluate(() => {
    const state = window.getFFAState();
    if (!state || !state.localId) return { error: 'no local player' };
    const entry = state.players[state.localId];
    if (!entry) return { error: 'no entry for local player' };

    // Simulate a mouse click by dispatching on canvas
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
      canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    }

    // Also try direct weapon fire if available
    const w = entry.weapon || (entry.entity && entry.entity.weapon);
    const ammo = w ? w.ammo : 'unknown';
    const magSize = w ? w.magSize : 'unknown';
    return { ok: true, ammo, magSize };
  });

  if (shootResult.error) {
    fail('FFA: Shoot attempt', shootResult.error);
  } else {
    pass('FFA: Shoot attempt', `ammo: ${shootResult.ammo}/${shootResult.magSize}`);
  }

  // Check for freeze: record lastTs, wait 1s, check again
  const ts1 = await page.evaluate(() => {
    const s = window.getFFAState();
    return s ? s.lastTs : 0;
  });
  await sleep(1000);
  const ts2 = await page.evaluate(() => {
    const s = window.getFFAState();
    return s ? s.lastTs : 0;
  });

  if (ts2 > ts1) {
    pass('FFA: No freeze', `lastTs advanced from ${ts1.toFixed(0)} to ${ts2.toFixed(0)} (+${(ts2 - ts1).toFixed(0)}ms)`);
  } else {
    fail('FFA: No freeze', `lastTs did NOT advance (${ts1} -> ${ts2})`);
  }

  // Report errors
  if (ffaErrors.length > 0) {
    fail('FFA: Page errors', `${ffaErrors.length} error(s): ${ffaErrors.slice(0, 5).join(' | ')}`);
  } else {
    pass('FFA: Page errors', 'none');
  }

  await page.close();
  return ffaErrors;
}

async function testAIMode(browser) {
  log('');
  log('=== AI MODE TEST ===');
  const page = await browser.newPage();
  const aiErrors = [];

  page.on('pageerror', err => {
    const msg = err.message || String(err);
    aiErrors.push(msg);
    log(`  PAGE_ERROR: ${msg}`);
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      aiErrors.push(text);
      log(`  CONSOLE_ERROR: ${text}`);
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 15000 });
  log('Page loaded');

  await sleep(1000);

  // Start AI game
  log('Starting AI game...');
  const startResult = await page.evaluate(() => {
    try {
      window.startPaintballGame();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  if (!startResult.ok) {
    fail('AI: Start game', startResult.error);
    await page.close();
    return aiErrors;
  }
  pass('AI: Start game', 'startPaintballGame called successfully');

  // Wait for initialization
  await sleep(2000);

  const stateCheck = await page.evaluate(() => {
    const state = window.getPaintballState();
    if (!state) return { error: 'getPaintballState() returned null' };
    return {
      hasPlayer: !!state.player,
      playerAlive: state.player ? state.player.alive : null,
      hasAI: !!state.ai,
      aiAlive: state.ai ? state.ai.alive : null,
      lastTs: state.lastTs,
      roundActive: state.match ? state.match.roundActive : null,
      inputEnabled: state.inputEnabled,
      heroSelectOpen: !!window._heroSelectOpen
    };
  });

  if (stateCheck.error) {
    fail('AI: State check', stateCheck.error);
  } else {
    log('  State: ' + JSON.stringify(stateCheck, null, 2));

    if (stateCheck.hasPlayer) pass('AI: Player exists', 'state.player present');
    else fail('AI: Player exists', 'state.player missing');

    if (stateCheck.hasAI) pass('AI: AI opponent exists', 'state.ai present');
    else fail('AI: AI opponent exists', 'state.ai missing');

    if (stateCheck.lastTs > 0) pass('AI: Tick running', `lastTs = ${stateCheck.lastTs.toFixed(0)}`);
    else fail('AI: Tick running', `lastTs = ${stateCheck.lastTs}`);
  }

  // Handle hero selection if open
  const heroSelectOpen = await page.evaluate(() => !!window._heroSelectOpen);
  if (heroSelectOpen) {
    log('Hero select overlay is open — clicking first card...');
    const heroClicked = await page.evaluate(() => {
      const overlay = document.getElementById('heroSelectOverlay');
      if (!overlay) return { ok: false, error: 'no overlay element' };
      const card = overlay.querySelector('.hero-card');
      if (!card) return { ok: false, error: 'no hero cards' };
      card.click();
      return { ok: true, heroId: card.dataset.heroId };
    });
    if (heroClicked.ok) {
      pass('AI: Hero select confirm', `selected hero: ${heroClicked.heroId}`);
    } else {
      fail('AI: Hero select confirm', heroClicked.error);
    }
  } else {
    pass('AI: Hero select', 'not blocking — already closed or bypassed');
  }

  // Wait for countdown to finish
  log('Waiting 5s for countdown...');
  await sleep(5000);

  const postCountdown = await page.evaluate(() => {
    const state = window.getPaintballState();
    if (!state) return { error: 'state null' };
    return {
      roundActive: state.match ? state.match.roundActive : null,
      inputEnabled: state.inputEnabled,
      lastTs: state.lastTs,
      heroSelectOpen: !!window._heroSelectOpen,
      playerAlive: state.player ? state.player.alive : null,
      aiAlive: state.ai ? state.ai.alive : null
    };
  });

  if (postCountdown.error) {
    fail('AI: Post-countdown state', postCountdown.error);
  } else {
    log('  Post-countdown: ' + JSON.stringify(postCountdown));
    if (postCountdown.roundActive) pass('AI: Round active', 'true');
    else fail('AI: Round active', `roundActive = ${postCountdown.roundActive}`);

    if (postCountdown.inputEnabled) pass('AI: Input enabled', 'true');
    else fail('AI: Input enabled', `inputEnabled = ${postCountdown.inputEnabled}`);

    if (postCountdown.playerAlive) pass('AI: Player alive', 'true');
    else fail('AI: Player alive', `playerAlive = ${postCountdown.playerAlive}`);

    if (postCountdown.aiAlive) pass('AI: AI alive', 'true');
    else fail('AI: AI alive', `aiAlive = ${postCountdown.aiAlive}`);
  }

  // Try shooting
  log('Attempting to shoot...');
  const shootResult = await page.evaluate(() => {
    const state = window.getPaintballState();
    if (!state || !state.player) return { error: 'no player' };
    const w = state.player.weapon;
    const ammoBefore = w ? w.ammo : 'unknown';

    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    }

    return { ok: true, ammo: ammoBefore, magSize: w ? w.magSize : 'unknown' };
  });

  if (shootResult.error) {
    fail('AI: Shoot attempt', shootResult.error);
  } else {
    pass('AI: Shoot attempt', `ammo: ${shootResult.ammo}/${shootResult.magSize}`);
  }

  // Release mouse
  await sleep(100);
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
  });

  // Check for freeze
  const ts1 = await page.evaluate(() => {
    const s = window.getPaintballState();
    return s ? s.lastTs : 0;
  });
  await sleep(1000);
  const ts2 = await page.evaluate(() => {
    const s = window.getPaintballState();
    return s ? s.lastTs : 0;
  });

  if (ts2 > ts1) {
    pass('AI: No freeze', `lastTs advanced from ${ts1.toFixed(0)} to ${ts2.toFixed(0)} (+${(ts2 - ts1).toFixed(0)}ms)`);
  } else {
    fail('AI: No freeze', `lastTs did NOT advance (${ts1} -> ${ts2})`);
  }

  // Report errors
  if (aiErrors.length > 0) {
    fail('AI: Page errors', `${aiErrors.length} error(s): ${aiErrors.slice(0, 5).join(' | ')}`);
  } else {
    pass('AI: Page errors', 'none');
  }

  await page.close();
  return aiErrors;
}

(async () => {
  log('Starting Puppeteer test suite...');
  log(`Target: ${URL}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
    });

    const ffaErrors = await testFFAMode(browser);
    const aiErrors = await testAIMode(browser);

    // Print summary
    log('');
    log('========================================');
    log('           TEST RESULTS SUMMARY         ');
    log('========================================');

    const passes = RESULTS.filter(r => r.status === 'PASS');
    const fails = RESULTS.filter(r => r.status === 'FAIL');

    for (const r of RESULTS) {
      const icon = r.status === 'PASS' ? '[PASS]' : '[FAIL]';
      console.log(`  ${icon} ${r.test}: ${r.detail || ''}`);
    }

    log('');
    log(`Total: ${RESULTS.length} tests | ${passes.length} passed | ${fails.length} failed`);

    if (ffaErrors.length > 0) {
      log(`FFA page errors (${ffaErrors.length}):`);
      ffaErrors.forEach(e => log(`  - ${e}`));
    }
    if (aiErrors.length > 0) {
      log(`AI page errors (${aiErrors.length}):`);
      aiErrors.forEach(e => log(`  - ${e}`));
    }

    log('');
    if (fails.length === 0) {
      log('ALL TESTS PASSED');
    } else {
      log(`${fails.length} TEST(S) FAILED`);
    }

    // Keep browser open briefly so user can see
    await sleep(3000);
  } catch (err) {
    log('FATAL ERROR: ' + err.message);
    console.error(err);
  } finally {
    if (browser) await browser.close();
  }
})();
