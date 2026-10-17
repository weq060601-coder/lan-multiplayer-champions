/**
 * 极简 STUN（RFC 5389 Binding）。
 *
 * 桌面浏览器会把局域网地址伪装成 `.local`，老安卓解析不了，双方就建不起直连。
 * 向本机这个服务发一次 Binding 请求后，响应里会带上真实 IPv4，WebRTC 就能用它连。
 */
import dgram from "node:dgram";

export const STUN_PORT = 41235;
const MAGIC = 0x2112a442;

export function attachLanStun(log) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("error", err => {
    log?.(`  [STUN] ${err.message}`);
  });

  socket.on("message", (msg, rinfo) => {
    const response = buildBindingResponse(msg, rinfo.address, rinfo.port);
    if (!response) return;
    try {
      socket.send(response, rinfo.port, rinfo.address);
    } catch {
      // 对端已消失时忽略
    }
  });

  socket.bind(STUN_PORT, "0.0.0.0", () => {
    log?.(`  [STUN] 已监听 UDP ${STUN_PORT}（交换真实局域网地址）`);
  });

  return socket;
}

export function buildBindingResponse(msg, address, port) {
  if (!msg || msg.length < 20 || msg[0] !== 0x00 || msg[1] !== 0x01) return null;
  if (msg.readUInt32BE(4) !== MAGIC) return null;
  const ip = parseIpv4(address);
  if (!ip) return null;

  const srcPort = port & 65535;
  const xorPort = srcPort ^ (MAGIC >>> 16);
  const xorIp = [
    ip[0] ^ ((MAGIC >>> 24) & 255),
    ip[1] ^ ((MAGIC >>> 16) & 255),
    ip[2] ^ ((MAGIC >>> 8) & 255),
    ip[3] ^ (MAGIC & 255),
  ];

  const buf = Buffer.alloc(44);
  buf.writeUInt16BE(0x0101, 0);
  buf.writeUInt16BE(24, 2);
  buf.writeUInt32BE(MAGIC, 4);
  msg.copy(buf, 8, 8, 20);

  buf.writeUInt16BE(0x0020, 20);
  buf.writeUInt16BE(8, 22);
  buf[25] = 0x01;
  buf.writeUInt16BE(xorPort, 26);
  buf[28] = xorIp[0];
  buf[29] = xorIp[1];
  buf[30] = xorIp[2];
  buf[31] = xorIp[3];

  buf.writeUInt16BE(0x0001, 32);
  buf.writeUInt16BE(8, 34);
  buf[37] = 0x01;
  buf.writeUInt16BE(srcPort, 38);
  buf[40] = ip[0];
  buf[41] = ip[1];
  buf[42] = ip[2];
  buf[43] = ip[3];
  return buf;
}

function parseIpv4(address) {
  const raw = String(address || "");
  const v4 = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  const parts = v4.split(".");
  if (parts.length !== 4) return null;
  const ip = parts.map(part => Number(part));
  if (ip.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ip;
}
