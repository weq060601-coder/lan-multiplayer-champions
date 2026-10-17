/**
 * 局域网 PeerJS 信令服务器（零依赖，挂在 launcher 的同一个 HTTP 端口上）
 *
 * 为什么必须有它：
 *   peerjs 客户端不传 host 时，默认连的是**公网** broker `0.peerjs.com`，
 *   ICE 默认用 `stun.l.google.com:19302`。这两个地址在国内基本连不通，
 *   于是所谓「局域网联机」实际变成「必须先连通两个被墙的公网服务」——当然连不上。
 *   把信令搬到局域网内自己的端口上，握手全程不出网，才是真的局域网联机。
 *
 * 实现的是 peerjs 1.5.5 客户端所需的那一小块协议：
 *   GET  {path}/peerjs/id                                        -> 纯文本随机 id
 *   WS   {path}/peerjs?key=peerjs&id=..&token=..&version=1.5.5
 *   服务端 -> 客户端：OPEN / ID-TAKEN / INVALID-KEY / EXPIRE / LEAVE / 转发的 OFFER·ANSWER·CANDIDATE
 *   客户端 -> 服务端：HEARTBEAT，或带 dst 的 OFFER·ANSWER·CANDIDATE·LEAVE
 *
 * 只做「按 dst 转发」这一件事，不碰媒体流、不做鉴权（局域网自用）。
 */

import crypto from "crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** 封一个未掩码的 WebSocket 帧（服务端发出的帧不能掩码） */
function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

const textFrame = text => encodeFrame(0x1, Buffer.from(text, "utf8"));
const pongFrame = payload => encodeFrame(0xa, payload);

/**
 * 从 socket 上按 RFC6455 解帧。客户端发来的帧一定是掩码的，需要用 mask key 还原。
 * 只关心文本帧（信令全是 JSON），二进制帧直接丢。
 */
function readFrames(socket, { onText, onClose, onPing }) {
  let buf = Buffer.alloc(0);
  let fragments = [];

  socket.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);

    for (;;) {
      if (buf.length < 2) return;

      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }

      let mask = null;
      if (masked) {
        if (buf.length < offset + 4) return;
        mask = buf.subarray(offset, offset + 4);
        offset += 4;
      }

      if (buf.length < offset + len) return;

      const payload = Buffer.from(buf.subarray(offset, offset + len));
      if (mask) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i & 3];
        }
      }
      buf = buf.subarray(offset + len);

      if (opcode === 0x8) {
        onClose();
        return;
      }
      if (opcode === 0x9) {
        onPing(payload);
        continue;
      }
      if (opcode === 0xa) {
        continue;
      }
      if (opcode === 0x1 || opcode === 0x0) {
        fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(fragments).toString("utf8");
          fragments = [];
          onText(text);
        }
        continue;
      }
      if (fin) {
        fragments = [];
      }
    }
  });
}

/**
 * 把信令服务挂到一个已有的 http.Server 上。
 *
 * @param httpServer 已创建但（通常）还没 listen 的 http server
 * @param options.path 客户端 Peer({path}) 里填的那个路径，默认 "/peerjs"
 * @param options.key  客户端 Peer({key}) ，默认 "peerjs"
 * @param options.log  日志函数，传 null 静默
 * @returns { handleHttp, getClientCount } handleHttp 要在静态文件逻辑之前调用，
 *          返回 true 表示这个请求已被信令服务处理掉了。
 */
export function attachPeerSignalServer(httpServer, options = {}) {
  const { key = "peerjs", log = console.log } = options;
  const rawPath = options.path ?? "/peerjs";
  const basePath = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;

  // 注意：ws 路径里的 "peerjs" 是客户端硬编码的字面量，不是 key（默认值恰好同名，别混）
  const wsPath = `${basePath}/peerjs`;
  const idPath = `${basePath}/${key}/id`;

  /** id -> { token, send, destroy } */
  const clients = new Map();

  function handleHttp(req, res) {
    const reqPath = req.url.split("?")[0];
    if (req.method === "OPTIONS" && (reqPath === idPath || reqPath === wsPath)) {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "600",
        "Content-Length": 0,
      });
      res.end();
      return true;
    }
    if (reqPath !== idPath) {
      return false;
    }
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Private-Network": "true",
      "Cache-Control": "no-store",
    });
    res.end(crypto.randomBytes(16).toString("hex"));
    return true;
  }

  httpServer.on("upgrade", (req, socket) => {
    const [reqPath, query] = req.url.split("?");
    const wsKey = req.headers["sec-websocket-key"];

    if (reqPath !== wsPath || !wsKey) {
      socket.destroy();
      return;
    }

    const accept = crypto.createHash("sha1").update(wsKey + WS_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);

    const send = obj => {
      if (!socket.destroyed) {
        socket.write(textFrame(JSON.stringify(obj)));
      }
    };

    const params = new URLSearchParams(query || "");
    const id = params.get("id");
    const token = params.get("token") || "";

    if (params.get("key") !== key) {
      send({ type: "INVALID-KEY" });
      socket.end();
      return;
    }
    if (!id) {
      socket.end();
      return;
    }

    const existing = clients.get(id);
    if (existing && existing.token !== token) {
      // 房间码撞了：房主端会收到 unavailable-id，提示换一个房间码
      send({ type: "ID-TAKEN", payload: { msg: `ID "${id}" is taken` } });
      socket.end();
      return;
    }
    if (existing) {
      existing.destroy(); // 同一 token 重连（刷新页面）：踢掉旧连接
    }

    const self = { token, send, destroy: () => socket.destroy() };
    clients.set(id, self);
    log?.(`  [信令] ${id} 已接入（当前 ${clients.size} 个）`);
    send({ type: "OPEN" });

    const cleanup = () => {
      if (clients.get(id) === self) {
        clients.delete(id);
        log?.(`  [信令] ${id} 已断开（当前 ${clients.size} 个）`);
        for (const [otherId, c] of clients) {
          c.send({ type: "LEAVE", src: id, dst: otherId });
        }
      }
      socket.destroy();
    };

    readFrames(socket, {
      onPing: payload => {
        if (!socket.destroyed) {
          socket.write(pongFrame(payload));
        }
      },
      onClose: cleanup,
      onText: text => {
        let msg;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (!msg || msg.type === "HEARTBEAT" || !msg.dst) {
          return;
        }
        const target = clients.get(msg.dst);
        if (!target) {
          // 客户端收到 EXPIRE 会报 peer-unavailable，即「房间不存在」
          send({ type: "EXPIRE", src: msg.dst, dst: id });
          return;
        }
        target.send({ type: msg.type, src: id, dst: msg.dst, payload: msg.payload });
      },
    });

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });

  function listRoomCodes() {
    const rooms = [];
    for (const id of clients.keys()) {
      const match = /^pokerogue-([a-z0-9]+)$/i.exec(id);
      if (match) rooms.push(match[1].toUpperCase());
    }
    return rooms;
  }

  return { handleHttp, getClientCount: () => clients.size, listRoomCodes };
}
