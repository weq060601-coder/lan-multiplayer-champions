/**
 * 局域网主机自动发现（安卓端）。
 *
 * 对端可以是电脑 launcher 或另一台已开房的安卓设备（UDP 应答）。
 * 手机广播探测，主机回 JSON，包含它实际使用的信令端口。
 *
 * 浏览器发不了 UDP。电脑当客机时，网页请求本机 launcher 的 /api/lan-discover，
 * 由启动器代发探测，才能找到安卓房主，而不是误把自己当成主机。
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { resolvePageSignalConfig, type SignalConfig } from "./signal-config";

/** 发现到的一台主机 */
export interface DiscoveredHost {
  /** 主机的局域网 IP。来自 UDP 回包的来源地址，不是电脑自报的值。 */
  host: string;
  /** 该主机 launcher 实际监听的 HTTP 端口 */
  port: number;
  /** 电脑的主机名，给玩家辨认用 */
  name: string;
  /**
   * 这台主机上正在开着的房间码。
   * null 表示对方是旧版本，回包里没有房间码。
   */
  rooms: string[] | null;
  /** true = 就是正在打开这个页面的电脑自己 */
  self: boolean;
}

interface LanDiscoveryPlugin {
  discover(): Promise<{ hosts: DiscoveredHost[] }>;
}

const PLUGIN_NAME = "LanDiscovery";

const LanDiscovery = registerPlugin<LanDiscoveryPlugin>(PLUGIN_NAME);

/** 搜索结果。`reason` 只在 `hosts` 为空时有意义，用来告诉玩家为什么没找到。 */
export interface DiscoveryResult {
  hosts: DiscoveredHost[];
  reason?: string;
}

/** 当前环境能不能用自动搜索。浏览器走 launcher 接口，安卓走原生插件。 */
export function isDiscoverySupported(): boolean {
  if (!Capacitor.isNativePlatform()) return true;
  // isPluginAvailable 兜住「装了旧 APK 但前端是新的」这种情况：
  // 那种包里没有原生插件，直接调会抛 "not implemented"。
  return Capacitor.isPluginAvailable(PLUGIN_NAME);
}

/**
 * 搜索局域网内正在运行信令服务的主机（电脑或安卓）。约 1~2 秒返回。
 *
 * 不抛异常 —— 失败一律折成 `{ hosts: [], reason }`，方便调用方直接显示给玩家。
 */
export async function discoverLanHosts(options?: { includeSelf?: boolean }): Promise<DiscoveryResult> {
  const includeSelf = options?.includeSelf === true;
  if (!Capacitor.isNativePlatform()) {
    return discoverFromLauncher(includeSelf);
  }

  if (!Capacitor.isPluginAvailable(PLUGIN_NAME)) {
    return {
      hosts: [],
      reason: "当前 APK 版本不含搜索功能，请更新 APK，或先手填电脑的地址。",
    };
  }

  try {
    const result = await LanDiscovery.discover();
    const hosts = normalizeHosts(result?.hosts, includeSelf);
    if (hosts.length === 0) {
      return {
        hosts: [],
        reason: "没找到局域网主机。请确认房主已创建房间、设备连的是同一 Wi-Fi，且路由器未隔离设备。",
      };
    }
    return { hosts };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { hosts: [], reason: `搜索失败：${msg}` };
  }
}

async function discoverFromLauncher(includeSelf: boolean): Promise<DiscoveryResult> {
  try {
    const query = includeSelf ? "?includeSelf=1" : "";
    const res = await fetch(`/api/lan-discover${query}`, { cache: "no-store" });
    if (!res.ok) {
      return {
        hosts: [],
        reason: "搜索接口不可用。请关闭游戏后重新双击「双击启动游戏.bat」，或在第 4 项手填安卓房主显示的 IP:端口。",
      };
    }
    const data = await res.json();
    const hosts = normalizeHosts(data?.hosts, includeSelf);
    if (hosts.length === 0) {
      const reason = typeof data?.reason === "string" ? data.reason : "";
      return {
        hosts: [],
        reason: reason || "没找到安卓房主。请先在手机上创建房间，确认和电脑是同一个 Wi-Fi。也可以在第 4 项手填手机上的 IP:端口。",
      };
    }
    return { hosts };
  } catch {
    return {
      hosts: [],
      reason: "当前页面没有局域网搜索服务。请关闭游戏后重新双击「双击启动游戏.bat」打开，或在第 4 项手填安卓房主的 IP:端口。",
    };
  }
}

function normalizeHosts(raw: unknown, includeSelf: boolean): DiscoveredHost[] {
  if (!Array.isArray(raw)) return [];
  const hosts: DiscoveredHost[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as { host?: unknown; port?: unknown; name?: unknown; self?: unknown; rooms?: unknown };
    const host = typeof record.host === "string" ? record.host : "";
    const port = Number(record.port);
    const self = record.self === true;
    if (!host || !Number.isInteger(port) || port <= 0 || (self && !includeSelf)) continue;
    const name = typeof record.name === "string" && record.name && record.name !== "127.0.0.1" && record.name !== "localhost"
      ? record.name
      : host;
    hosts.push({ host, port, name, rooms: normalizeRooms(record.rooms), self });
  }
  return hosts;
}

function normalizeRooms(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((item): item is string => typeof item === "string" && item.length > 0).map(item => item.toUpperCase());
}

function signalForHost(host: DiscoveredHost): SignalConfig {
  return {
    host: host.host,
    port: host.port,
    path: "/peerjs",
    secure: false,
    label: `${host.host}:${host.port}`,
    manual: true,
  };
}

/**
 * 按房间码找该连哪一台。
 * 先搜局域网，只连接正在开这个房间码的主机。
 * 本机对上了就走本机页面；别人对上了才连对方的地址。不会把地址存下来。
 */
export async function locateRoomSignal(roomCode: string): Promise<{ signal: SignalConfig } | { error: string }> {
  const code = roomCode.trim().toUpperCase();
  const result = await discoverLanHosts({ includeSelf: true });
  const matches = result.hosts.filter(host => host.rooms?.includes(code));
  const picked = matches.find(host => !host.self) ?? matches[0];
  if (picked) {
    if (picked.self && !Capacitor.isNativePlatform()) {
      return { signal: resolvePageSignalConfig() };
    }
    return { signal: signalForHost(picked) };
  }

  // 旧版本主机不广播房间码。只有一台时还能连，多了就没法判断是哪一间。
  const legacy = result.hosts.filter(host => host.rooms == null && !host.self);
  if (legacy.length === 1) {
    return { signal: signalForHost(legacy[0]) };
  }
  if (result.hosts.length === 0) {
    return { error: result.reason || `没找到房间码 ${code}。请确认房主已经建房，并且和你在同一 Wi-Fi。` };
  }
  return { error: `局域网里没有房间码 ${code}。请核对房主屏幕上的 4 位房间码。` };
}
