const CACHE='pomodial-web-v3-responsive-tabs';
const ASSETS=['./','./index.html','./styles.css','./app.js','./i18n.js','./manifest.webmanifest','./assets/icons/icon-192.png','./assets/icons/icon-512.png',...'chime marimba bell bowl digital pop'.split(' ').map(s=>`./assets/sounds/${s}.wav`)];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});
