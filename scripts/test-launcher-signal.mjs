/**
 * 端到端验证「launcher 同端口既发网页又当信令服务器」
 *   node scripts/test-launcher-signal.mjs
 *
 * 覆盖：静态首页可取 / id 接口可用 / 两个客户端能通过 launcher 端口互转 OFFER-ANSWER
 * 这一层是 test-signal-server.mjs 测不到的：那个用的是自建裸 http server。
 */
import { spawn } from "child_process";
import assert from "assert";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [path.join(__dirname, "launcher.mjs")], {
  env: { ...process.env, POKEROGUE_NO_BROWSER: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let banner = "";
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("launcher 30s 内没有就绪")), 30000);
  child.stdout.on("data", buf => {
    banner += buf.toString();
    const m = banner.match(/本机访问: http:\/\/localhost:(\d+)/);
    if (m) {
      clearTimeout(timer);
      resolve(Number(m[1]));
    }
  });
  child.stderr.on("data", b => process.stderr.write(b));
  child.on("exit", code => reject(new Error(`launcher 提前退出，code=${code}`)));
});

const base = `127.0.0.1:${port}`;
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`  ✅ ${name}`);
  } catch (err) {
    results.push(`  ❌ ${name} -> ${err.message}`);
    process.exitCode = 1;
  }
};

function connect(id) {
  const ws = new WebSocket(`ws://${base}/peerjs/peerjs?key=peerjs&id=${id}&token=t-${id}&version=1.5.5`);
  const inbox = [];
  const waiters = [];
  ws.addEventListener("message", e => {
    const msg = JSON.parse(e.data);
    const w = waiters.shift();
    if (w) w(msg);
    else inbox.push(msg);
  });
  return {
    ws,
    next: () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise(r => waiters.push(r))),
    send: obj => ws.send(JSON.stringify(obj)),
  };
}

await check("同端口仍能取到游戏首页", async () => {
  const res = await fetch(`http://${base}/`);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("<script"), "首页里没有 script 标签，dist 可能不对");
});

await check("同端口的 peerjs id 接口可用", async () => {
  const res = await fetch(`http://${base}/peerjs/peerjs/id?ts=1&version=1.5.5`);
  assert.strictEqual(res.status, 200);
  assert.match((await res.text()).trim(), /^[0-9a-f]{32}$/);
});

await check("房主与客机通过 launcher 端口完成 OFFER/ANSWER 交换", async () => {
  const host = connect("pokerogue-4321");
  const client = connect("client-e2e");
  assert.strictEqual((await host.next()).type, "OPEN");
  assert.strictEqual((await client.next()).type, "OPEN");

  client.send({ type: "OFFER", dst: "pokerogue-4321", payload: { sdp: "e2e-offer" } });
  const offer = await host.next();
  assert.strictEqual(offer.src, "client-e2e");
  assert.strictEqual(offer.payload.sdp, "e2e-offer");

  host.send({ type: "ANSWER", dst: "client-e2e", payload: { sdp: "e2e-answer" } });
  assert.strictEqual((await client.next()).payload.sdp, "e2e-answer");

  host.ws.close();
  client.ws.close();
});

await check("launcher 打印了局域网信令提示", async () => {
  assert.ok(/联机信令服务器已在同一端口就绪/.test(banner), "启动横幅里没有信令提示");
});

// 发现服务是安卓端「自动搜索」的对端。它必须随 launcher 一起起来，
// 而且必须知道**实际**端口（launcher 的端口是浮动的：8000 被占就 +1）。
await check("局域网发现服务随 launcher 就绪", async () => {
  assert.ok(/局域网发现服务已就绪 \(UDP 41234\)/.test(banner), "启动横幅里没有发现服务提示");
});

await check("发现服务回报的是 launcher 的实际端口", async () => {
  const dgram = await import("dgram");
  const { DISCOVERY_PORT, PROBE_MAGIC } = await import("./lan-discovery.mjs");

  const reply = await new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      sock.close();
      reject(new Error("探测 1.5s 内没有回包"));
    }, 1500);
    sock.on("message", msg => {
      clearTimeout(timer);
      sock.close();
      try {
        resolve(JSON.parse(msg.toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    sock.bind(() => {
      sock.send(Buffer.from(PROBE_MAGIC, "utf8"), DISCOVERY_PORT, "127.0.0.1", err => {
        if (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  });

  assert.strictEqual(reply.app, "pokerogue-lan", "回包 app 字段不对");
  assert.strictEqual(reply.httpPort, port, `回包端口 ${reply.httpPort} 与 launcher 实际端口 ${port} 不一致`);
});

await check("网页可以请求启动器代搜局域网主机", async () => {
  const res = await fetch(`http://${base}/api/lan-discover?includeSelf=1`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.hosts), "搜索结果不是列表");
  assert.ok(
    body.hosts.some(host => host.port === port && host.self === true),
    `没有搜到测试启动器自己：${JSON.stringify(body)}`,
  );
});

await check("局域网地址接口可用", async () => {
  const res = await fetch(`http://${base}/api/lan-info`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.ips), "没有返回地址列表");
  assert.strictEqual(body.stunPort, 41235);
});

await check("STUN 服务能回真实地址", async () => {
  const dgram = await import("dgram");
  const mapped = await new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      sock.close();
      reject(new Error("STUN 1.5s 内没有回包"));
    }, 1500);
    sock.on("message", msg => {
      clearTimeout(timer);
      sock.close();
      resolve(msg);
    });
    const tx = Buffer.alloc(20);
    tx[1] = 1;
    tx.writeUInt32BE(0x2112a442, 4);
    sock.bind(() => sock.send(tx, 41235, "127.0.0.1", err => err && reject(err)));
  });
  assert.strictEqual(mapped[0], 0x01);
  assert.strictEqual(mapped[1], 0x01);
  assert.strictEqual(mapped.length, 44);
});

child.kill();
console.log("\nlauncher + 信令端到端自测：");
console.log(results.join("\n"));
console.log(process.exitCode ? "\n有用例失败\n" : "\n全部通过\n");
