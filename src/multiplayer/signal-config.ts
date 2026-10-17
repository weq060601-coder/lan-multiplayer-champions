/**
 * 联机信令服务器地址解析。
 *
 * 背景：peerjs 不传 host 时会去连公网 broker `0.peerjs.com`，ICE 用 `stun.l.google.com`，
 * 国内两个都连不通 —— 这就是「局域网联机根本连不上」的根因。
 * 现在信令由 `scripts/peer-signal-server.mjs` 挂在 launcher 的同一个 HTTP 端口上提供，
 * 所以客户端要自己算出「该连哪台机器」。
 *
 * 解析顺序：
 *   1. 玩家手填的地址（存 localStorage）—— 安卓 APK 版只能走这条，因为 APK 是从本机
 *      capacitor 服务加载页面的，location 里拿不到局域网主机地址。
 *   2. 页面自身的来源。电脑当房主时，客机打开的就是这台 launcher。
 *      手机当房主时，电脑必须先自动搜索或手填手机的 IP:端口，不能沿用 localhost。
 */

import { Capacitor } from "@capacitor/core";

const OVERRIDE_KEY = "pokerogue_signal_host";

export interface SignalConfig {
  host: string;
  port: number;
  path: string;
  secure: boolean;
  /** 给报错信息用的可读形式，例如 `192.168.1.7:8000` */
  label: string;
  /** true = 来自玩家手填 */
  manual: boolean;
}

/** 读取玩家手填的信令地址，形如 `192.168.1.7` 或 `192.168.1.7:8000` */
export function getSignalOverride(): string {
  try {
    return localStorage.getItem(OVERRIDE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** 保存玩家手填的信令地址；传空字符串则清除，回到自动解析 */
export function setSignalOverride(value: string): void {
  try {
    const trimmed = value.trim();
    if (trimmed) {
      localStorage.setItem(OVERRIDE_KEY, trimmed);
    } else {
      localStorage.removeItem(OVERRIDE_KEY);
    }
  } catch {
    // localStorage 不可用时忽略：本轮仍可用自动解析
  }
}

export function resolvePageSignalConfig(): SignalConfig {
  const loc = window.location;
  const secure = loc.protocol === "https:";
  const port = Number(loc.port) || (secure ? 443 : 80);
  const host = loc.hostname || "localhost";
  return { host, port, path: "/peerjs", secure, label: `${host}:${port}`, manual: false };
}

export function resolveSignalConfig(): SignalConfig {
  const override = getSignalOverride();

  if (override) {
    const cleaned = override.replace(/^\w+:\/\//, "").replace(/\/.*$/, "");
    const [host, portText] = cleaned.split(":");
    const port = Number(portText) || 8000;
    return { host, port, path: "/peerjs", secure: false, label: `${host}:${port}`, manual: true };
  }

  return resolvePageSignalConfig();
}

/**
 * 建房用的信令地址。
 * 安卓房主刚把本机端口写进手填地址，必须沿用。
 * 电脑房主要连自己的 launcher。上次加入手机时保存的 IP 不能拿来建房，
 * 否则电脑会去连已经关掉的手机信令，报「连不上联机服务器」。
 */
export function resolveHostSignalConfig(): SignalConfig {
  if (Capacitor.isNativePlatform()) {
    return resolveSignalConfig();
  }
  return resolvePageSignalConfig();
}

/**
 * 连不上信令服务器时给玩家看的话。
 * 分两种情况写，因为安卓和浏览器要做的事完全不同。
 */
export function describeSignalFailure(config: SignalConfig, role: "host" | "client" = "client"): string {
  if (role === "host") {
    if (Capacitor.isNativePlatform()) {
      return `连不上手机自己的联机服务 ${config.label}。请回到大厅重新创建房间。`;
    }
    return `连不上这台电脑自己的联机服务 ${config.label}：请确认「双击启动游戏.bat」还在运行，然后完全退出再打开游戏。`;
  }
  if (config.manual) {
    return `连不上联机服务器 ${config.label}：请确认房主已经创建房间，且手机和电脑在同一 Wi-Fi。可以重新自动搜索，或核对房主屏幕上的 IP:端口。`;
  }
  if (config.host === "localhost" || config.host === "127.0.0.1") {
    if (Capacitor.isNativePlatform()) {
      return `连不上联机服务器：请在大厅选「自动搜索局域网主机」，或手填房主显示的 IP:端口。`;
    }
    return `当前连的是这台电脑自己，不是安卓房主。请先在手机上创建房间，再选「自动搜索局域网主机」，或在第 4 项填入手机显示的 IP:端口。`;
  }
  return `连不上联机服务器 ${config.label}：请确认这台机器上的「双击启动游戏.bat」仍在运行。`;
}
