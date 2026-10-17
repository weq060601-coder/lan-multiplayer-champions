import { Peer, type DataConnection } from "peerjs";
import { type NetworkPacket, PacketType } from "./multiplayer-types";
import { describeSignalFailure, resolveHostSignalConfig, resolveSignalConfig, type SignalConfig } from "./signal-config";
import { getEmbeddedSignalAddress, prepareSignalServerForHost } from "./embedded-signal-server";

/** 建房 / 加房时等信令服务器的上限，超时就报错，不能无限挂着 */
const SIGNAL_TIMEOUT_MS = 8000;
/** 客机连上信令后，等 WebRTC 通道真正打开的上限 */
const DATACHANNEL_TIMEOUT_MS = 12000;
/** 与 scripts/lan-stun.mjs、安卓信令插件使用同一个端口 */
const STUN_PORT = 41235;

/**
 * 生成 peerjs 客户端配置。
 *
 * 信令走局域网自建服务，不能用公网 `0.peerjs.com`。
 * 另外加一个同网的 STUN：桌面浏览器会把局域网地址伪装成 `.local`，
 * 老安卓解析不了，只靠 host candidate 经常建不起直连。
 */
function buildPeerOptions(signal: SignalConfig, stunHost: string) {
  return {
    host: signal.host,
    port: signal.port,
    path: signal.path,
    secure: signal.secure,
    key: "peerjs",
    debug: 1,
    config: { iceServers: [{ urls: `stun:${stunHost}:${STUN_PORT}` }] },
  };
}

async function resolveStunHost(signal: SignalConfig): Promise<string> {
  const embedded = getEmbeddedSignalAddress().split(":")[0];
  if (embedded && embedded !== "127.0.0.1" && embedded !== "localhost") return embedded;
  if (signal.host !== "localhost" && signal.host !== "127.0.0.1") return signal.host;
  try {
    const res = await fetch("/api/lan-info", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const ip = Array.isArray(data?.ips)
        ? data.ips.find((item: unknown) => typeof item === "string" && item && item !== "127.0.0.1")
        : "";
      if (typeof ip === "string" && ip) return ip;
    }
  } catch {
    // 不是从 launcher 打开时，退回信令主机
  }
  return signal.host;
}


export type PacketHandler = (packet: NetworkPacket) => void;
export type ConnectionHandler = (peerId: string) => void;
export type DisconnectHandler = () => void;
export type ErrorHandler = (error: Error) => void;

/**
 * 局域网 / P2P 网络传输层
 * 基于 PeerJS (WebRTC DataChannel) 提供极低延迟的点对点与房主-客机双向通信
 */
export class NetworkTransport {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private hostConnection: DataConnection | null = null;

  public isHost = false;
  public myPeerId = "";
  public myPlayerName = "Trainer";

  private packetHandlers: PacketHandler[] = [];
  private connectHandlers: ConnectionHandler[] = [];
  private disconnectHandlers: DisconnectHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];

  private pingTimer: any = null;

  /**
   * 初始化为房主 (Host)
   * @param roomCode 房间短码 (例如 6 位数字/字母)
   */
  public async createHost(roomCode: string, playerName: string): Promise<string> {
    this.resetConnection();
    this.isHost = true;
    this.myPlayerName = playerName;

    // 安卓作为房主时在手机本机启动信令服务器，不再依赖电脑 launcher。
    // 电脑建房必须连自己的 launcher，不能沿用上次加入手机时保存的地址。
    await prepareSignalServerForHost();
    const signal = resolveHostSignalConfig();
    const stunHost = await resolveStunHost(signal);

    return new Promise((resolve, reject) => {
      const peerId = `pokerogue-${roomCode.toLowerCase()}`;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.resetConnection();
        reject(new Error(describeSignalFailure(signal, "host")));
      }, SIGNAL_TIMEOUT_MS);

      try {
        this.peer = new Peer(peerId, buildPeerOptions(signal, stunHost));

        this.peer.on("open", (id: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.myPeerId = id;
          this.setupPingTimer();
          resolve(id);
        });

        this.peer.on("connection", (conn: DataConnection) => {
          this.handleIncomingConnection(conn);
        });

        this.peer.on("error", (err: any) => {
          console.warn("[Multiplayer] Host Peer error:", err);
          this.errorHandlers.forEach(h => h(new Error(err.message || String(err))));
          if (settled) return;

          // 只有「还没开房成功」的错误才该让建房失败，开房之后的掉线走 errorHandlers
          if (err.type === "unavailable-id") {
            settled = true;
            clearTimeout(timer);
            reject(new Error(`房间码 ${roomCode} 已被占用，换一个再试。`));
          } else if (err.type === "network" || err.type === "server-error" || err.type === "socket-error") {
            settled = true;
            clearTimeout(timer);
            reject(new Error(describeSignalFailure(signal, "host")));
          }
        });
      } catch (err: any) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /**
   * 初始化为客机 (Client) 并加入房间
   * @param roomCode 房主的房间码
   */
  public async joinHost(roomCode: string, playerName: string, signalOverride?: SignalConfig): Promise<boolean> {
    this.resetConnection();
    this.isHost = false;
    this.myPlayerName = playerName;
    // 调用方已经按房间码搜到主机时，只用这一次的地址，不要写进 localStorage。
    const signal = signalOverride ?? resolveSignalConfig();
    const stunHost = await resolveStunHost(signal);

    return new Promise((resolve, reject) => {
      const targetHostId = `pokerogue-${roomCode.toLowerCase()}`;
      let settled = false;

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(signalTimer);
        clearTimeout(channelTimer);
        this.resetConnection();
        reject(new Error(message));
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(signalTimer);
        clearTimeout(channelTimer);
        resolve(true);
      };

      // 两段超时：先是连信令服务器，再是 WebRTC 通道打开。分开报错才知道卡在哪一步。
      const signalTimer = setTimeout(() => fail(describeSignalFailure(signal)), SIGNAL_TIMEOUT_MS);
      let channelTimer: any = null;

      try {
        this.peer = new Peer(buildPeerOptions(signal, stunHost));

        this.peer.on("open", (id: string) => {
          clearTimeout(signalTimer);
          this.myPeerId = id;
          channelTimer = setTimeout(
            () => fail(`连上了联机服务器，但没能和房主建立直连。请确认两台设备在同一 Wi-Fi、且没被「AP 隔离 / 访客网络」挡住。`),
            DATACHANNEL_TIMEOUT_MS,
          );

          const conn = this.peer!.connect(targetHostId, {
            reliable: true,
          });

          this.hostConnection = conn;
          this.setupConnectionListeners(conn, true, succeed, err => fail(err.message));
        });

        this.peer.on("error", (err: any) => {
          console.warn("[Multiplayer] Client Peer error:", err);
          this.errorHandlers.forEach(h => h(new Error(err.message || String(err))));

          if (err.type === "peer-unavailable") {
            fail(`找不到房间 ${roomCode}：请确认房主已经建好房、房间码没打错，且和你连在同一个联机服务器上。`);
          } else if (err.type === "network" || err.type === "server-error" || err.type === "socket-error") {
            fail(describeSignalFailure(signal));
          } else {
            fail(err.message || String(err));
          }
        });
      } catch (err: any) {
        fail(err.message || String(err));
      }
    });
  }

  private handleIncomingConnection(conn: DataConnection): void {
    this.connections.set(conn.peer, conn);
    this.setupConnectionListeners(conn, false, () => {
      this.connectHandlers.forEach(h => h(conn.peer));
    });
  }

  private setupConnectionListeners(
    conn: DataConnection,
    isToHost: boolean,
    onOpenSuccess?: () => void,
    onOpenFail?: (err: Error) => void,
  ): void {
    let hasOpened = false;

    conn.on("open", () => {
      hasOpened = true;
      if (onOpenSuccess) onOpenSuccess();
    });

    conn.on("data", (data: any) => {
      this.handleIncomingData(data);
    });

    conn.on("close", () => {
      if (isToHost) {
        this.hostConnection = null;
      } else {
        this.connections.delete(conn.peer);
      }
      this.disconnectHandlers.forEach(h => h());
    });

    conn.on("error", (err: any) => {
      console.warn("[Multiplayer] Connection error:", err);
      if (!hasOpened && onOpenFail) {
        onOpenFail(new Error(err.message || "Failed to establish peer connection"));
      }
    });
  }

  private handleIncomingData(data: any): void {
    try {
      const packet: NetworkPacket = typeof data === "string" ? JSON.parse(data) : data;
      if (packet && packet.type) {
        if (packet.type === PacketType.PING) {
          this.send(PacketType.PONG, { timestamp: Date.now() });
          return;
        }
        if (packet.type === PacketType.PONG) {
          return;
        }

        // 如果是 Host，在处理包的同时广播给其他客户端（若有多个客户端）
        if (this.isHost && this.connections.size > 1) {
          this.broadcast(packet.type, packet.payload, packet.senderId);
        }

        this.packetHandlers.forEach(h => h(packet));
      }
    } catch (e) {
      console.error("[Multiplayer] Failed to parse incoming packet:", e);
    }
  }

  /**
   * 发送网络数据包
   */
  public send<T = any>(type: PacketType, payload: T): void {
    const packet: NetworkPacket<T> = {
      type,
      senderId: this.myPeerId,
      senderName: this.myPlayerName,
      timestamp: Date.now(),
      payload,
    };

    const data = JSON.stringify(packet);

    if (this.isHost) {
      this.connections.forEach(conn => {
        if (conn.open) {
          conn.send(data);
        }
      });
    } else if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send(data);
    }
  }

  /**
   * 房主广播数据包（可选排除某个 Peer）
   */
  public broadcast<T = any>(type: PacketType, payload: T, excludePeerId?: string): void {
    if (!this.isHost) return;

    const packet: NetworkPacket<T> = {
      type,
      senderId: this.myPeerId,
      senderName: this.myPlayerName,
      timestamp: Date.now(),
      payload,
    };

    const data = JSON.stringify(packet);

    this.connections.forEach((conn, peerId) => {
      if (peerId !== excludePeerId && conn.open) {
        conn.send(data);
      }
    });
  }

  /** 向指定已连接的 Peer 发送一个包，用于房间握手等单客户端同步。 */
  public sendToPeer<T = any>(peerId: string, type: PacketType, payload: T): boolean {
    if (!this.isHost) return false;
    const conn = this.connections.get(peerId);
    if (!conn?.open) return false;
    const packet: NetworkPacket<T> = {
      type,
      senderId: this.myPeerId,
      senderName: this.myPlayerName,
      timestamp: Date.now(),
      payload,
    };
    conn.send(JSON.stringify(packet));
    return true;
  }

  public onPacket(handler: PacketHandler): () => void {
    this.packetHandlers.push(handler);
    return () => {
      this.packetHandlers = this.packetHandlers.filter(h => h !== handler);
    };
  }

  public onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.push(handler);
    return () => {
      this.connectHandlers = this.connectHandlers.filter(h => h !== handler);
    };
  }

  public onDisconnect(handler: DisconnectHandler): () => void {
    this.disconnectHandlers.push(handler);
    return () => {
      this.disconnectHandlers = this.disconnectHandlers.filter(h => h !== handler);
    };
  }

  public onError(handler: ErrorHandler): () => void {
    this.errorHandlers.push(handler);
    return () => {
      this.errorHandlers = this.errorHandlers.filter(h => h !== handler);
    };
  }

  private setupPingTimer(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.isConnected()) {
        this.send(PacketType.PING, {});
      }
    }, 5000);
  }

  public isConnected(): boolean {
    if (this.isHost) {
      return Array.from(this.connections.values()).some(c => c.open);
    }
    return !!(this.hostConnection && this.hostConnection.open);
  }

  public getConnectedPeerCount(): number {
    if (this.isHost) {
      return Array.from(this.connections.values()).filter(c => c.open).length;
    }
    return this.isConnected() ? 1 : 0;
  }

  /**
   * 仅重置底层 P2P 连接（Peer / DataChannel / 心跳），**保留**已注册的事件监听器。
   *
   * 创建房间、加入房间、离开房间时都必须用这个而不是 destroy()：
   * MultiplayerManager 等模块的 onPacket 监听器只在单例构造时注册一次，
   * 一旦被清空就再也不会重新注册，之后收到的所有网络包都会被静默丢弃。
   */
  public resetConnection(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.connections.forEach(conn => conn.close());
    this.connections.clear();

    if (this.hostConnection) {
      this.hostConnection.close();
      this.hostConnection = null;
    }

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    this.isHost = false;
    this.myPeerId = "";
  }

  /**
   * 彻底销毁传输层：断开连接并注销所有监听器。
   * 只在整个联机子系统不再使用时调用（正常玩法流程里不要用）。
   */
  public destroy(): void {
    this.resetConnection();

    this.packetHandlers = [];
    this.connectHandlers = [];
    this.disconnectHandlers = [];
    this.errorHandlers = [];
  }
}
