/**
 * build.js — Bundle and minify game JS for production.
 *
 * Concatenates all game scripts (in dependency order) into a single file,
 * then minifies with terser. The result is bundle.min.js which server.js
 * auto-detects and serves to players instead of individual source files.
 *
 * Usage:  npm run build
 * Reset:  delete bundle.min.js to go back to dev mode
 */
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

// Game scripts in dependency order (matches index.html).
// devConsole.js is intentionally excluded — dev tools don't ship to players.
const SCRIPTS = [
  'config.js',
  'audio.js',
  'weapon.js',
  'weaponModels.js',
  'physics.js',
  'crosshair.js',
  'hud.js',
  'roundFlow.js',
  'heroes.js',
  'abilities.js',
  'heroSelectUI.js',
  'menuRenderer.js',
  'input.js',
  'environment.js',
  'player.js',
  'arenaBuilder.js',
  'arenaCompetitive.js',
  'arenaTraining.js',
  'mapFormat.js',
  'mapThumbnail.js',
  'menuNavigation.js',
  'projectiles.js',
  'aiOpponent.js',
  'trainingBot.js',
  'modeTraining.js',
  'modeFFA.js',
  'ffaScoreboard.js',
  'game.js'
];

async function build() {
  // Concatenate all source files
  var combined = '';
  for (var i = 0; i < SCRIPTS.length; i++) {
    var filePath = path.join(__dirname, SCRIPTS[i]);
    if (!fs.existsSync(filePath)) {
      console.error('Missing file: ' + SCRIPTS[i]);
      process.exit(1);
    }
    combined += fs.readFileSync(filePath, 'utf8') + '\n';
  }

  // Minify: mangle variable names, compress, strip comments
  var result = await minify(combined, {
    compress: { passes: 2 },
    mangle: { toplevel: false },  // don't mangle window.* globals
    format: { comments: false }
  });

  if (result.error) {
    console.error('Minification failed:', result.error);
    process.exit(1);
  }

  fs.writeFileSync(path.join(__dirname, 'bundle.min.js'), result.code, 'utf8');

  var originalKB = Math.round(combined.length / 1024);
  var minifiedKB = Math.round(result.code.length / 1024);
  console.log('Built bundle.min.js (' + originalKB + ' KB -> ' + minifiedKB + ' KB)');
  console.log('Run "node server.js" to serve the minified version to players.');
}

build();
