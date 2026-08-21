/* Revs & Reads service worker — network-first shell, cache as offline fallback */
var CACHE='slayers-cache-v9';
var CORE=['./','./index.html','./manifest.webmanifest'];
self.addEventListener('install',function(e){
  /* best-effort precache: a missing asset must NOT fail install, or the old worker never steps aside */
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return Promise.all(CORE.map(function(u){return c.add(u).catch(function(){});}));
    }).then(function(){return self.skipWaiting();})
  );
});
self.addEventListener('activate',function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){if(k!==CACHE)return caches.delete(k);}));
    }).then(function(){return self.clients.claim();})
  );
});
self.addEventListener('message',function(e){ if(e.data==='skipWaiting')self.skipWaiting(); });
self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET')return;
  var req=e.request;
  try{ if(new URL(req.url).origin!==self.location.origin) return; }catch(_){}
  var isDoc = req.mode==='navigate' || (req.headers.get('accept')||'').indexOf('text/html')>-1;
  if(isDoc){
    /* network-first: always try the latest page when online; fall back to cache offline */
    e.respondWith(
      fetch(req).then(function(resp){
        try{var cp=resp.clone();caches.open(CACHE).then(function(c){c.put('./index.html',cp);});}catch(_){}
        return resp;
      }).catch(function(){
        return caches.match(req).then(function(h){return h||caches.match('./index.html');});
      })
    );
    return;
  }
  e.respondWith(caches.match(req).then(function(hit){
    if(hit)return hit;
    return fetch(req).then(function(resp){
      try{var cp=resp.clone();caches.open(CACHE).then(function(c){c.put(req,cp);});}catch(_){}
      return resp;
    });
  }));
});
