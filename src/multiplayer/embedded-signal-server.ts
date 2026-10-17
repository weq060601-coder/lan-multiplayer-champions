import { Capacitor, registerPlugin } from "@capacitor/core";
import { setSignalOverride } from "./signal-config";

interface LanSignalServerPlugin {
  start(): Promise<{ host: string; port: number }>;
  stop(): Promise<void>;
}

const PLUGIN_NAME = "LanSignalServer";
const LanSignalServer = registerPlugin<LanSignalServerPlugin>(PLUGIN_NAME);
const PUBLIC_ADDRESS_KEY = "pokerogue_signal_public_host";

/** 安卓房主启动本机 PeerJS 信令服务；桌面浏览器继续使用 launcher 的服务。 */
export async function prepareSignalServerForHost(): Promise<string | null> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable(PLUGIN_NAME)) return null;
  const result = await LanSignalServer.start();
  // 房主本机经 loopback 连接，其他设备通过 UDP 发现返回的 LAN IP 和端口连接。
  setSignalOverride(`127.0.0.1:${result.port}`);
  try { localStorage.setItem(PUBLIC_ADDRESS_KEY, `${result.host}:${result.port}`); } catch { }
  return `${result.host}:${result.port}`;
}

export function getEmbeddedSignalAddress(): string {
  try { return localStorage.getItem(PUBLIC_ADDRESS_KEY) ?? ""; } catch { return ""; }
}
