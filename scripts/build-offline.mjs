import { readFile, writeFile, readdir, cp } from "node:fs/promises";
import { join } from "node:path";
const buildId = (await readFile(".next/BUILD_ID", "utf8")).trim();
const html = await readFile(".next/server/app/index.html", "utf8");
await writeFile("public/offline.html", html);
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
      ),
    )
  ).flat();
}
const assets = (await files(".next/static"))
  .filter((p) => /\.(js|css|woff2?)$/.test(p))
  .map((p) => p.replace(".next/", "/_next/"));
const shell = [
  "/offline.html",
  "/manifest.webmanifest",
  "/assets/icon.svg",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/apple-touch-icon.png",
  ...assets,
];
await writeFile(
  "public/sw.js",
  `const CACHE = ${JSON.stringify("lift-cloud-" + buildId)};
const SHELL = ${JSON.stringify(shell)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(url=>new Request(url,{cache:'reload'})))).then(()=>{if(!self.registration.active)return self.skipWaiting();})));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('lift-cloud-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||event.request.headers.has('rsc'))return;
 if(event.request.mode==='navigate'&&['/','/offline.html'].includes(url.pathname)){
   event.respondWith(fetch(event.request).then(async response=>response.ok?response:(await caches.match('/offline.html'))??response).catch(()=>caches.match('/offline.html')));return;
 }
 if(SHELL.includes(url.pathname))event.respondWith(caches.match(event.request,{ignoreSearch:true}).then(cached=>cached??fetch(event.request)));
});
`,
);
console.log(
  `Prepared offline shell with ${shell.length} static assets. Auth and API responses are excluded.`,
);
await cp("public", ".next/standalone/public", { recursive: true });
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
