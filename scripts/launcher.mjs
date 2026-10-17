import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import { attachPeerSignalServer } from "./peer-signal-server.mjs";
import { attachLanDiscovery, discoverLanHosts, emptyDiscoveryReason, listLanIpv4, DISCOVERY_PORT } from "./lan-discovery.mjs";
import { attachLanStun, STUN_PORT } from "./lan-stun.mjs";
import { patchPvpStarterBundle } from "./patch-pvp-starter-bundle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let distPath = path.resolve(__dirname, "../dist");
if (!fs.existsSync(distPath)) {
  distPath = path.resolve(process.cwd(), "dist");
}
if (!fs.existsSync(distPath)) {
  distPath = path.resolve(process.cwd(), "repo/dist");
}

const mimeTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".ico": "image/x-icon",
  ".woff": "application/font-woff",
  ".ttf": "application/font-ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".otf": "application/font-otf",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json"
};

function getLanIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

function openBrowser(port) {
  // 自动化测试时不弹窗口（scripts/test-launcher-signal.mjs 会设这个变量）
  if (process.env.POKEROGUE_NO_BROWSER === "1") return;
  const url = `http://localhost:${port}`;
  console.log(`  正在为你自动打开本机游戏窗口 (${url}) ...`);
  exec(`start msedge --app=${url}`, (err) => {
    if (err) {
      exec(`start ${url}`);
    }
  });
}

const patchedJs = new Map();

function readPatchedJs(filePath, stats) {
  const key = `${filePath}:${stats.mtimeMs}:${stats.size}`;
  const cached = patchedJs.get(key);
  if (cached) {
    return cached;
  }
  const original = fs.readFileSync(filePath, "utf8");
  const patched = patchPvpStarterBundle(original, path.basename(filePath));
  if (patched.notes.length) {
    console.log(`  [PVP选人补丁] ${path.basename(filePath)}: ${patched.notes.join("；")}`);
  }
  const body = Buffer.from(patched.source);
  patchedJs.set(key, body);
  return body;
}

function prewarmPvpPatch() {
  const assets = path.join(distPath, "assets");
  if (!fs.existsSync(assets)) {
    return;
  }
  for (const name of fs.readdirSync(assets)) {
    if (!name.endsWith(".js")) {
      continue;
    }
    const filePath = path.join(assets, name);
    const stats = fs.statSync(filePath);
    if (stats.size > 8_000_000) {
      continue;
    }
    const sample = fs.readFileSync(filePath, "utf8");
    if (
      sample.includes("getLevelMoves")
      || sample.includes("（不进化）")
      || sample.includes("battle-scene-erKXNiKp.js?v=")
    ) {
      readPatchedJs(filePath, stats);
    }
  }
}

function startServer(port = 8000) {
  if (!fs.existsSync(distPath)) {
    console.error(`  [错误] 未找到 dist 资源目录: ${distPath}`);
    return;
  }

  const server = http.createServer((req, res) => {
    const rawPath = (req.url || "/").split("?")[0];
    if (rawPath === "/api/lan-discover" || rawPath === "/api/lan-info") {
      handleLanApi(req, res, rawPath);
      return;
    }
    // 联机信令走这里；不是信令请求才落到静态文件
    if (signal.handleHttp(req, res)) return;

    let reqPath = decodeURI(req.url.split("?")[0]);
    if (reqPath === "/") reqPath = "/index.html";
    const filePath = path.join(distPath, reqPath);

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = mimeTypes[ext] || "application/octet-stream";
      const cacheControl = ext === ".html" || ext === ".js" || ext === ".mjs" ? "no-store" : "no-cache";
      if (ext === ".js" || ext === ".mjs") {
        try {
          const body = readPatchedJs(filePath, stats);
          res.writeHead(200, {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": cacheControl,
            "Content-Length": body.length,
          });
          res.end(body);
          return;
        } catch (patchErr) {
          console.warn("  [PVP选人补丁] 读取失败，改发原文件", patchErr);
        }
      }
      res.writeHead(200, {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": cacheControl
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  // 局域网信令服务：让 WebRTC 握手只在内网转发，不依赖 0.peerjs.com 这类公网 broker
  const signal = attachPeerSignalServer(server, { path: "/peerjs" });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(`  [提示] 端口 ${port} 已被占用，正在切换下一个可用端口...`);
      if (port < 8020) {
        startServer(port + 1);
      } else {
        openBrowser(8000);
      }
    } else {
      console.error("  [启动异常]", err);
    }
  });

  server.listen(port, "0.0.0.0", () => {
    const lanIps = getLanIps();
    console.log("================================================================");
    console.log("  🎮 PokéRogue 局域网联机版已启动！");
    console.log("");
    console.log(`  💻 本机访问: http://localhost:${port}`);
    if (lanIps.length > 0) {
      console.log("  📱 安卓手机 / 平板 / 局域网设备访问 (连接同一 Wi-Fi):");
      lanIps.forEach(ip => {
        console.log(`     👉 http://${ip}:${port}`);
      });
      console.log("");
      console.log("  📡 联机信令服务器已在同一端口就绪（握手不出网）。");
      console.log("     电脑当房主：安卓大厅选「自动搜索局域网主机」。");
      console.log("     手机当房主：先在安卓创建房间，再在电脑大厅里自动搜索。");
      console.log("     搜索失败时，手填房主屏幕上的 IP:端口，例如：");
      lanIps.forEach(ip => {
        console.log(`     👉 ${ip}:${port}`);
      });
      console.log("");
      // 安卓 5.x / 6.x 装不了本项目的 APK（Capacitor 引用了 API 24 的框架类，一进去就闪退，
      // 见交接文档缺陷 8）。但那些机器用 Firefox 143 打开上面的网址是可以玩的 ——
      // Firefox 自带 Gecko 引擎，不受系统那个 2014 年的老 WebView 限制。
      console.log("  🦊 安卓 5.x / 6.x 的老设备：装不了 APK，请用 Firefox 143 打开上面网址。");
      console.log("     （系统自带浏览器太老跑不了；Firefox 143 是支持安卓 5.0~7.1 的最后一版）");
    }
    console.log("================================================================");

    // ⚠️ 必须放在 listen 成功之后：port 是重试后才定下来的（8000 被占就 +1），
    //    发现服务要告诉手机的正是这个最终值。写死 8000 就等于白做。
    attachLanDiscovery(port, { listRooms: () => signal.listRoomCodes() });
    attachLanStun();
    prewarmPvpPatch();

    openBrowser(port);
  });
}

function handleLanApi(req, res, reqPath) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (reqPath === "/api/lan-info") {
    res.writeHead(200);
    res.end(JSON.stringify({ ips: listLanIpv4(), stunPort: STUN_PORT, discoveryPort: DISCOVERY_PORT }));
    return;
  }

  const includeSelf = new URL(req.url || "/", "http://127.0.0.1").searchParams.get("includeSelf") === "1";
  discoverLanHosts({ includeSelf: true }).then(hosts => {
    const visible = includeSelf ? hosts : hosts.filter(host => !host.self);
    res.writeHead(200);
    res.end(JSON.stringify({
      hosts: visible,
      reason: visible.length === 0 ? emptyDiscoveryReason(hosts.some(host => host.self)) : "",
    }));
  }).catch(err => {
    res.writeHead(500);
    res.end(JSON.stringify({ hosts: [], reason: `搜索失败：${err instanceof Error ? err.message : String(err)}` }));
  });
}

startServer(8000);
