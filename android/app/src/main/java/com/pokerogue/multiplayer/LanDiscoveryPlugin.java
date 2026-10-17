package com.pokerogue.multiplayer;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 局域网主机发现 —— UDP 探测端（跑在手机上）。
 *
 * 对端是电脑上的 scripts/lan-discovery.mjs。手机发一个广播，电脑回一个 JSON，
 * 里面带着它真正在用的 HTTP 端口（launcher 那个端口是浮动的，8000 被占就 +1）。
 *
 * 为什么要走原生：浏览器 JS 里没有 UDP，只能靠 HTTP 逐个 IP 去扫，
 * 而 JS 拿不到手机自己的网段（WebRTC 的 host candidate 现在被 mDNS 混淆了），
 * 只能猜常见网段 —— 换个冷门网段就找不到。UDP 广播不用猜网段也不用猜端口。
 */
@CapacitorPlugin(name = "LanDiscovery")
public class LanDiscoveryPlugin extends Plugin {

    /** 与 scripts/lan-discovery.mjs 里的 DISCOVERY_PORT 必须一致 */
    private static final int DISCOVERY_PORT = 41234;

    /** 与 scripts/lan-discovery.mjs 里的 PROBE_MAGIC 必须一致 */
    private static final String PROBE_MAGIC = "POKEROGUE_LAN_DISCOVER?";

    /** 回包里的 app 字段，用来确认「回话的是我们的服务」而不是局域网里别的什么东西 */
    private static final String EXPECTED_APP = "pokerogue-lan";

    /** 收包总预算。给到 1.2 秒：局域网往返通常几毫秒，留足余量应付慢设备。 */
    private static final int TOTAL_BUDGET_MS = 1200;

    /** 单次 receive 的超时，用来切分总预算，避免卡死在最后一次 receive 上 */
    private static final int RECV_SLICE_MS = 200;

    @PluginMethod
    public void discover(PluginCall call) {
        // ⚠️ 必须开线程：Capacitor 默认在主线程调插件方法，
        //    主线程碰网络会直接抛 NetworkOnMainThreadException。
        new Thread(() -> runDiscovery(call)).start();
    }

    private void runDiscovery(PluginCall call) {
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket();
            socket.setBroadcast(true);
            socket.setSoTimeout(RECV_SLICE_MS);

            byte[] probe = PROBE_MAGIC.getBytes("UTF-8");
            int sent = 0;
            for (InetAddress target : broadcastTargets()) {
                try {
                    socket.send(new DatagramPacket(probe, probe.length, target, DISCOVERY_PORT));
                    sent++;
                } catch (Exception ignored) {
                    // 某张网卡发不出去不影响其他网卡，继续
                }
            }

            if (sent == 0) {
                call.reject("发不出广播包：手机好像没连上任何网络。请确认已连 Wi-Fi。");
                return;
            }

            JSArray hosts = collectReplies(socket);

            JSObject result = new JSObject();
            result.put("hosts", hosts);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("局域网搜索失败: " + e.getMessage(), e);
        } finally {
            if (socket != null) {
                socket.close();
            }
        }
    }

    /** 在总预算内反复收包，按来源 IP 去重 */
    private JSArray collectReplies(DatagramSocket socket) {
        JSArray hosts = new JSArray();
        Set<String> seen = new HashSet<>();
        byte[] buf = new byte[2048];
        long deadline = System.currentTimeMillis() + TOTAL_BUDGET_MS;

        while (System.currentTimeMillis() < deadline) {
            DatagramPacket reply = new DatagramPacket(buf, buf.length);
            try {
                socket.receive(reply);
            } catch (Exception e) {
                continue; // 这一片超时了，看看还有没有预算
            }

            String fromIp = reply.getAddress().getHostAddress();
            if (fromIp == null || seen.contains(fromIp)) {
                continue;
            }

            try {
                String body = new String(reply.getData(), reply.getOffset(), reply.getLength(), "UTF-8");
                JSONObject json = new JSONObject(body);
                if (!EXPECTED_APP.equals(json.optString("app"))) {
                    continue; // 局域网里别的程序，不是我们的
                }

                int httpPort = json.optInt("httpPort", 0);
                if (httpPort <= 0 || httpPort > 65535) {
                    continue;
                }

                seen.add(fromIp);

                JSObject host = new JSObject();
                // ⚠️ 用数据包的来源地址，不用电脑自报的 IP。
                //    电脑可能有多张网卡（有线/无线/虚拟机），自报的未必是能通的那张；
                //    回包必然从「能到手机的那张」出去，来源地址一定对。
                host.put("host", fromIp);
                host.put("port", httpPort);
                host.put("name", json.optString("name", fromIp));
                JSONArray rooms = json.optJSONArray("rooms");
                if (rooms != null) {
                    JSArray roomList = new JSArray();
                    for (int i = 0; i < rooms.length(); i++) {
                        String room = rooms.optString(i, "").trim();
                        if (!room.isEmpty()) roomList.put(room.toUpperCase());
                    }
                    host.put("rooms", roomList);
                }
                hosts.put(host);
            } catch (Exception ignored) {
                // 回包不是合法 JSON，跳过
            }
        }

        return hosts;
    }

    /**
     * 收集所有该发广播的目标地址。
     *
     * ⚠️ 光发 255.255.255.255 不够：部分路由器和国产 ROM 会把全局广播丢掉，只认子网广播
     *    （比如 192.168.10.255）。所以枚举每张网卡，把各自的子网广播地址都发一份。
     */
    private List<InetAddress> broadcastTargets() {
        List<InetAddress> targets = new ArrayList<>();

        try {
            targets.add(InetAddress.getByName("255.255.255.255"));
        } catch (Exception ignored) {
            // 理论上不会失败
        }

        try {
            Enumeration<NetworkInterface> nics = NetworkInterface.getNetworkInterfaces();
            if (nics == null) {
                return targets;
            }
            for (NetworkInterface nic : Collections.list(nics)) {
                if (nic.isLoopback() || !nic.isUp()) {
                    continue;
                }
                for (InterfaceAddress addr : nic.getInterfaceAddresses()) {
                    InetAddress broadcast = addr.getBroadcast();
                    if (broadcast != null) {
                        targets.add(broadcast);
                    }
                }
            }
        } catch (Exception ignored) {
            // 枚举失败就只靠 255.255.255.255
        }

        return targets;
    }
}
