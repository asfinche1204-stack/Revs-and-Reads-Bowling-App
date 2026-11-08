/* Revs & Reads service worker — network-first shell, cache as offline fallback */
var CACHE='slayers-cache-v35';
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
  var path=''; try{ path=new URL(req.url).pathname; }catch(_){}
  /* pages AND page-file fetches (leaders/stats pages read index.html for live data) go network-first */
  var isDoc = req.mode==='navigate' || (req.headers.get('accept')||'').indexOf('text/html')>-1 || /(\.html|\/)$/.test(path);
  if(isDoc){
    e.respondWith(
      fetch(req).then(function(resp){
        try{
          var cp=resp.clone(), scope=new URL(self.registration.scope).pathname;
          var isShell = path===scope || path===scope+'index.html';
          /* each page is cached under its OWN url; only the app shell refreshes ./index.html */
          caches.open(CACHE).then(function(c){ c.put(isShell?'./index.html':req, cp); });
        }catch(_){}
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
