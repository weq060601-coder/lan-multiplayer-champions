/**
 * 信令服务器自测（不需要浏览器，用 Node 自带的 WebSocket 客户端跑）
 *   node scripts/test-signal-server.mjs
 *
 * 覆盖：id 分配接口 / OPEN 握手 / 按 dst 转发 / 目标不存在时回 EXPIRE / 房间码撞车回 ID-TAKEN
 */

import http from "http";
import assert from "assert";
import { attachPeerSignalServer } from "./peer-signal-server.mjs";

const server = http.createServer((req, res) => {
  if (signal.handleHttp(req, res)) return;
  res.writeHead(404).end();
});
const signal = attachPeerSignalServer(server, { log: null });

await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `127.0.0.1:${port}`;

/** 连一个 peerjs 客户端风格的 socket，返回 { ws, next() } */
function connect(id, token = "tok") {
  const ws = new WebSocket(`ws://${base}/peerjs/peerjs?key=peerjs&id=${id}&token=${token}&version=1.5.5`);
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
    closed: new Promise(r => ws.addEventListener("close", r)),
  };
}

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

await check("id 接口返回 32 位十六进制 id", async () => {
  const res = await fetch(`http://${base}/peerjs/peerjs/id?ts=1&version=1.5.5`);
  assert.strictEqual(res.status, 200);
  const id = (await res.text()).trim();
  assert.match(id, /^[0-9a-f]{32}$/);
});

const host = connect("pokerogue-abc123");
const client = connect("client-1");

await check("双方都收到 OPEN", async () => {
  assert.strictEqual((await host.next()).type, "OPEN");
  assert.strictEqual((await client.next()).type, "OPEN");
});

await check("OFFER 按 dst 转发给房主，并带上 src", async () => {
  client.send({ type: "OFFER", dst: "pokerogue-abc123", payload: { sdp: "fake-offer" } });
  const msg = await host.next();
  assert.strictEqual(msg.type, "OFFER");
  assert.strictEqual(msg.src, "client-1");
  assert.strictEqual(msg.payload.sdp, "fake-offer");
});

await check("ANSWER 与 CANDIDATE 反向也能转发", async () => {
  host.send({ type: "ANSWER", dst: "client-1", payload: { sdp: "fake-answer" } });
  assert.strictEqual((await client.next()).payload.sdp, "fake-answer");
  host.send({ type: "CANDIDATE", dst: "client-1", payload: { candidate: "host-candidate" } });
  const msg = await client.next();
  assert.strictEqual(msg.type, "CANDIDATE");
  assert.strictEqual(msg.payload.candidate, "host-candidate");
});

await check("HEARTBEAT 不会被当成信令转发", async () => {
  client.send({ type: "HEARTBEAT" });
  client.send({ type: "OFFER", dst: "pokerogue-abc123", payload: { sdp: "after-heartbeat" } });
  assert.strictEqual((await host.next()).payload.sdp, "after-heartbeat");
});

await check("连不存在的房间码 -> EXPIRE（客户端会报 peer-unavailable）", async () => {
  client.send({ type: "OFFER", dst: "pokerogue-nobody", payload: {} });
  const msg = await client.next();
  assert.strictEqual(msg.type, "EXPIRE");
  assert.strictEqual(msg.src, "pokerogue-nobody");
});

await check("同一房间码被别人占用 -> ID-TAKEN", async () => {
  const dup = connect("pokerogue-abc123", "another-token");
  const msg = await dup.next();
  assert.strictEqual(msg.type, "ID-TAKEN");
  await dup.closed;
});

await check("房主断线后客机收到 LEAVE", async () => {
  host.ws.close();
  const msg = await client.next();
  assert.strictEqual(msg.type, "LEAVE");
  assert.strictEqual(msg.src, "pokerogue-abc123");
});

client.ws.close();
server.close();
console.log("\n信令服务器自测：");
console.log(results.join("\n"));
console.log(process.exitCode ? "\n有用例失败\n" : "\n全部通过\n");
