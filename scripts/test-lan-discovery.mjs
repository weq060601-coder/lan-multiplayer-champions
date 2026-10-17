/**
 * 局域网发现服务的自检脚本。
 *
 * 只验证电脑这一侧：起一个应答器，再用一个客户端 socket 发真实的广播探测包，
 * 看能不能收到格式正确的回包。安卓侧发的是同样的包，所以这一步过了，
 * 就能把问题范围缩到「安卓侧」或「路由器拦广播」，不用来回重打 APK 排查。
 *
 * 跑法：node scripts/test-lan-discovery.mjs
 */

import dgram from "dgram";
import { attachLanDiscovery, DISCOVERY_PORT, PROBE_MAGIC } from "./lan-discovery.mjs";

const FAKE_HTTP_PORT = 8003; // 故意不用 8000，验证「浮动端口能被正确带回来」

let failures = 0;

function check(label, ok, detail = "") {
  console.log(`${ok ? "  ✅" : "  ❌"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) {
    failures++;
  }
}

function probeOnce(target, timeoutMs = 1000) {
  return new Promise(resolve => {
    const client = dgram.createSocket("udp4");
    let done = false;

    const finish = value => {
      if (done) {
        return;
      }
      done = true;
      try {
        client.close();
      } catch {
        // 已关
      }
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    client.on("message", msg => {
      clearTimeout(timer);
      try {
        finish(JSON.parse(msg.toString("utf8")));
      } catch {
        finish({ __parseError: msg.toString("utf8") });
      }
    });

    client.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });

    client.bind(() => {
      client.setBroadcast(true);
      client.send(Buffer.from(PROBE_MAGIC, "utf8"), DISCOVERY_PORT, target, err => {
        if (err) {
          clearTimeout(timer);
          finish(null);
        }
      });
    });
  });
}

console.log("=== 局域网发现服务自检 ===");
console.log("");

const discovery = attachLanDiscovery(FAKE_HTTP_PORT);

// 给 bind 一点时间
await new Promise(r => setTimeout(r, 300));

console.log("[1] 回环地址探测（验证应答逻辑本身）");
const loopback = await probeOnce("127.0.0.1");
check("收到回包", loopback !== null, loopback === null ? "超时" : "");
if (loopback) {
  check("app 字段正确", loopback.app === "pokerogue-lan", `实际 ${loopback.app}`);
  check(
    `httpPort 带回的是实际端口 ${FAKE_HTTP_PORT}`,
    loopback.httpPort === FAKE_HTTP_PORT,
    `实际 ${loopback.httpPort}`,
  );
  check("signalPath 正确", loopback.signalPath === "/peerjs", `实际 ${loopback.signalPath}`);
  check("带了主机名", typeof loopback.name === "string" && loopback.name.length > 0, loopback.name);
  check("回包里不含 IP（应由手机用来源地址）", loopback.host === undefined, `host=${loopback.host}`);
}

console.log("");
console.log("[2] 广播地址探测（验证安卓侧那条路径）");
const broadcast = await probeOnce("255.255.255.255");
check("收到回包", broadcast !== null, broadcast === null ? "超时（本机防火墙可能拦了广播）" : "");
if (broadcast) {
  check("httpPort 一致", broadcast.httpPort === FAKE_HTTP_PORT, `实际 ${broadcast.httpPort}`);
}

console.log("");
console.log("[3] 非法探测包应被忽略（防止误答别的程序）");
const garbage = await new Promise(resolve => {
  const client = dgram.createSocket("udp4");
  let got = false;
  client.on("message", () => {
    got = true;
  });
  client.bind(() => {
    client.send(Buffer.from("HELLO_SOMETHING_ELSE", "utf8"), DISCOVERY_PORT, "127.0.0.1", () => {
      setTimeout(() => {
        try {
          client.close();
        } catch {
          // 已关
        }
        resolve(got);
      }, 400);
    });
  });
});
check("没有回应无关的包", garbage === false, garbage ? "居然回了" : "");

discovery.close();

console.log("");
console.log("================================");
if (failures === 0) {
  console.log("  全部通过 ✅");
} else {
  console.log(`  有 ${failures} 项失败 ❌`);
}
console.log("================================");
process.exit(failures === 0 ? 0 : 1);
