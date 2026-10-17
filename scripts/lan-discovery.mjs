/**
 * 局域网主机发现。
 *
 * 浏览器自己发不了 UDP。启动器在这里做两件事：
 * - 回答别人的探测（电脑当房主时，安卓才能找到它）；
 * - 主动探测局域网，再通过 /api/lan-discover 把结果交给网页（电脑当客机时找安卓房主）。
 */
import dgram from "node:dgram";
import os from "node:os";

export const DISCOVERY_PORT = 41234;
export const DISCOVERY_MAGIC = "POKEROGUE_LAN_DISCOVER?";
export const PROBE_MAGIC = DISCOVERY_MAGIC;
const PROBE_TIMEOUT_MS = 1500;

export function attachLanDiscovery(httpPort, logOrOptions = console.log) {
  const options = typeof logOrOptions === "function" ? { log: logOrOptions } : (logOrOptions ?? {});
  const log = options.log ?? console.log;
  const listRooms = options.listRooms ?? (() => []);
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("error", err => {
    log?.(`  [发现] 局域网广播不可用：${err.message}`);
  });

  socket.on("message", (msg, rinfo) => {
    if (msg.toString("utf8") !== DISCOVERY_MAGIC) return;
    try {
      socket.send(discoveryReply(httpPort, listRooms()), rinfo.port, rinfo.address);
    } catch {
      // 忽略单个探测失败
    }
  });

  socket.bind(DISCOVERY_PORT, "0.0.0.0", () => {
    try {
      socket.setBroadcast(true);
    } catch {
      // 仅回答单播也可以工作
    }
    log?.(`  [发现] 局域网发现服务已就绪 (UDP ${DISCOVERY_PORT})`);
  });

  return socket;
}

export function listLanIpv4() {
  /** @type {string[]} */
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      const v4 = net.family === "IPv4" || net.family === 4;
      if (!v4 || net.internal || !net.address || net.address.startsWith("169.254.")) continue;
      ips.push(net.address);
    }
  }
  ips.sort((a, b) => rankLanIp(a) - rankLanIp(b) || a.localeCompare(b));
  return [...new Set(ips)];
}

/**
 * @param {{ timeoutMs?: number, includeSelf?: boolean }} [options]
 * @returns {Promise<Array<{ host: string, port: number, name: string, self: boolean }>>}
 */
export function discoverLanHosts(options = {}) {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const includeSelf = options.includeSelf === true;

  return new Promise(resolve => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const found = new Map();
    const locals = localIpSet();
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      try {
        socket.close();
      } catch {
        // 已经关掉
      }
      const hosts = [...found.values()];
      resolve(includeSelf ? hosts : hosts.filter(host => !host.self));
    };

    socket.on("error", finish);
    socket.on("message", (msg, rinfo) => {
      let data;
      try {
        data = JSON.parse(msg.toString("utf8"));
      } catch {
        return;
      }
      if (!data || data.app !== "pokerogue-lan" || !data.httpPort) return;
      const host = normalizeIp(rinfo.address);
      const port = Number(data.httpPort);
      if (!host || host === "0.0.0.0" || !Number.isInteger(port) || port <= 0) return;
      const key = `${host}:${port}`;
      if (found.has(key)) return;
      found.set(key, {
        host,
        port,
        name: data.name || host,
        self: locals.has(host),
        rooms: normalizeRooms(data.rooms),
      });
    });

    socket.bind(0, "0.0.0.0", () => {
      try {
        socket.setBroadcast(true);
      } catch {
        // 仍然可以向已知地址单播
      }
      const probe = Buffer.from(DISCOVERY_MAGIC, "utf8");
      for (const target of broadcastTargets()) {
        try {
          socket.send(probe, DISCOVERY_PORT, target);
        } catch {
          // 某个网卡发不出去不影响其他网卡
        }
      }
      setTimeout(finish, timeoutMs);
    });
  });
}

export function emptyDiscoveryReason(sawSelf) {
  return sawSelf
    ? "只找到了这台电脑自己，没有找到安卓房主。请先在手机上创建房间，确认和电脑是同一个 Wi-Fi，且路由器没有 AP 隔离。也可以在第 4 项手填手机上显示的 IP:端口。"
    : "没找到局域网主机。请确认安卓已创建房间、手机和电脑在同一 Wi-Fi，且路由器没有 AP 隔离。也可以在第 4 项手填手机上显示的 IP:端口。";
}

function discoveryReply(httpPort, rooms) {
  return Buffer.from(JSON.stringify({
    app: "pokerogue-lan",
    httpPort,
    stunPort: 41235,
    name: "本机启动器",
    signalPath: "/peerjs",
    rooms: Array.isArray(rooms) ? rooms : [],
  }), "utf8");
}

function normalizeRooms(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.filter(item => typeof item === "string" && item).map(item => item.toUpperCase());
}

function localIpSet() {
  const ips = new Set(["127.0.0.1", "::1", "localhost"]);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net?.address) ips.add(normalizeIp(net.address));
    }
  }
  return ips;
}

function broadcastTargets() {
  const targets = new Set(["255.255.255.255", "127.0.0.1"]);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      const v4 = net.family === "IPv4" || net.family === 4;
      if (!v4 || net.internal || !net.address) continue;
      targets.add(net.address);
      const broadcast = broadcastAddress(net.address, net.netmask);
      if (broadcast) targets.add(broadcast);
    }
  }
  return [...targets];
}

function broadcastAddress(ip, mask) {
  const ipn = ipv4ToInt(ip);
  const maskn = ipv4ToInt(mask);
  if (ipn == null || maskn == null) return null;
  return intToIpv4(((ipn & maskn) | (~maskn >>> 0)) >>> 0);
}

function ipv4ToInt(ip) {
  const parts = String(ip || "").split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = ((value << 8) | n) >>> 0;
  }
  return value;
}

function intToIpv4(value) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function normalizeIp(address) {
  const raw = String(address || "");
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

function rankLanIp(ip) {
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  const match = /^172\.(\d+)\./.exec(ip);
  if (match) {
    const n = Number(match[1]);
    if (n >= 16 && n <= 31) return 2;
  }
  return 5;
}
