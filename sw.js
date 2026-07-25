/* Revs & Reads service worker — offline app shell */
var CACHE='rr-cache-v1';
var CORE=['./','./index.html','./manifest.webmanifest'];
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(CORE);}).then(function(){return self.skipWaiting();}));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){return Promise.all(keys.map(function(k){if(k!==CACHE)return caches.delete(k);}));}).then(function(){return self.clients.claim();}));
});
self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET')return;
  e.respondWith(caches.match(e.request).then(function(hit){
    if(hit)return hit;
    return fetch(e.request).then(function(resp){
      try{var cp=resp.clone();caches.open(CACHE).then(function(c){c.put(e.request,cp);});}catch(_){}
      return resp;
    }).catch(function(){ if(e.request.mode==='navigate')return caches.match('./index.html'); });
  }));
});