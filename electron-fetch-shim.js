(function () {
  if (!window.devAPI) return; // Not in Electron — leave fetch untouched

  var _realFetch = window.fetch;

  var routes = {
    maps:            { list: 'listMaps',         read: 'readMap',          write: 'writeMap',          del: 'deleteMap' },
    heroes:          { list: 'listHeroes',        read: 'readHero',         write: 'writeHero',         del: 'deleteHero' },
    'weapon-models': { list: 'listWeaponModels',  read: 'readWeaponModel',  write: 'writeWeaponModel',  del: 'deleteWeaponModel' },
    menus:           { list: 'listMenus',         read: 'readMenu',          write: 'writeMenu',          del: 'deleteMenu' },
    sounds:          { list: 'listSounds',        read: 'readSound',         write: 'writeSound',         del: 'deleteSound' }
  };

  function makeResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  window.fetch = function (url, opts) {
    if (typeof url !== 'string' || url.indexOf('/api/') !== 0) {
      return _realFetch.apply(this, arguments);
    }

    var method = (opts && opts.method || 'GET').toUpperCase();
    // Parse: /api/{resource} or /api/{resource}/{name}
    var parts = url.replace(/^\/api\//, '').split('/');
    var resource = decodeURIComponent(parts[0]);
    var name = parts[1] ? decodeURIComponent(parts[1]) : null;
    var route = routes[resource];

    // Hero sounds mapping API (single file, not name-based)
    if (resource === 'hero-sounds') {
      try {
        if (method === 'GET') {
          return Promise.resolve(makeResponse(window.devAPI.readHeroSounds(), 200));
        }
        if (method === 'POST') {
          var body = opts && opts.body ? JSON.parse(opts.body) : {};
          var res = window.devAPI.writeHeroSounds(body);
          return Promise.resolve(makeResponse(res, res.error ? 500 : 200));
        }
      } catch (e) {
        return Promise.resolve(makeResponse({ error: e.message }, 500));
      }
      return Promise.resolve(makeResponse({ error: 'Not found' }, 404));
    }

    // Weapon model files API (binary GLB files)
    if (resource === 'weapon-model-files') {
      try {
        if (method === 'GET' && !name) {
          return Promise.resolve(makeResponse(window.devAPI.listWeaponModelFiles(), 200));
        }
        if (method === 'GET' && name) {
          // Return raw binary file as an ArrayBuffer response
          var fileData = window.devAPI.readWeaponModelFile(name);
          if (fileData && fileData.error) {
            return Promise.resolve(makeResponse(fileData, 404));
          }
          return Promise.resolve(new Response(fileData, {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' }
          }));
        }
        if (method === 'POST' && name) {
          var body = opts && opts.body ? JSON.parse(opts.body) : {};
          var res = window.devAPI.writeWeaponModelFile(name, body.data);
          return Promise.resolve(makeResponse(res, res.error ? 500 : 200));
        }
        if (method === 'DELETE' && name) {
          var res = window.devAPI.deleteWeaponModelFile(name);
          return Promise.resolve(makeResponse(res, res.error ? 500 : 200));
        }
      } catch (e) {
        return Promise.resolve(makeResponse({ error: e.message }, 500));
      }
      return Promise.resolve(makeResponse({ error: 'Not found' }, 404));
    }

    // Sound files API (binary files, not JSON)
    if (resource === 'sound-files') {
      try {
        if (method === 'GET' && !name) {
          return Promise.resolve(makeResponse(window.devAPI.listSoundFiles(), 200));
        }
        if (method === 'POST' && name) {
          var body = opts && opts.body ? JSON.parse(opts.body) : {};
          var res = window.devAPI.writeSoundFile(name, body.data);
          return Promise.resolve(makeResponse(res, res.error ? 500 : 200));
        }
        if (method === 'DELETE' && name) {
          var res = window.devAPI.deleteSoundFile(name);
          return Promise.resolve(makeResponse(res, res.error ? 500 : 200));
        }
      } catch (e) {
        return Promise.resolve(makeResponse({ error: e.message }, 500));
      }
      return Promise.resolve(makeResponse({ error: 'Not found' }, 404));
    }

    if (!route) {
      return Promise.resolve(makeResponse({ error: 'Unknown resource' }, 404));
    }

    try {
      if (method === 'GET' && !name) {
        return Promise.resolve(makeResponse(window.devAPI[route.list](), 200));
      }
      if (method === 'GET' && name) {
        var res = window.devAPI[route.read](name);
        return Promise.resolve(makeResponse(res.data !== undefined ? res.data : res, res.status));
      }
      if (method === 'POST' && name) {
        var body = opts && opts.body ? JSON.parse(opts.body) : {};
        var res = window.devAPI[route.write](name, body);
        return Promise.resolve(makeResponse(res, res.status));
      }
      if (method === 'DELETE' && name) {
        var res = window.devAPI[route.del](name);
        return Promise.resolve(makeResponse(res, res.status));
      }
    } catch (e) {
      return Promise.resolve(makeResponse({ error: e.message }, 500));
    }

    return Promise.resolve(makeResponse({ error: 'Not found' }, 404));
  };
})();
