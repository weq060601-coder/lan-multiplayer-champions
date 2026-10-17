package com.pokerogue.multiplayer;

import android.util.Base64;
import android.content.Context;
import android.net.wifi.WifiManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.Enumeration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Embedded PeerJS 1.5.x LAN signaling endpoint for Android-to-Android play. */
@CapacitorPlugin(name = "LanSignalServer")
public class LanSignalServerPlugin extends Plugin {
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int DISCOVERY_PORT = 41234;
    private static final int STUN_PORT = 41235;
    private static final String PROBE = "POKEROGUE_LAN_DISCOVER?";
    private final Map<String, Client> clients = new ConcurrentHashMap<>();
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private volatile ServerSocket server;
    private volatile DatagramSocket discovery;
    private volatile DatagramSocket stun;
    private volatile WifiManager.MulticastLock multicastLock;
    private volatile int port;

    @PluginMethod
    public synchronized void start(PluginCall call) {
        try {
            if (server == null || server.isClosed()) {
                server = new ServerSocket(0, 32, InetAddress.getByName("0.0.0.0"));
                port = server.getLocalPort();
                final ServerSocket active = server;
                workers.execute(() -> acceptLoop(active));
                try {
                    WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    if (wifi != null) {
                        multicastLock = wifi.createMulticastLock("pokerogue-lan-discovery");
                        multicastLock.setReferenceCounted(false);
                        multicastLock.acquire();
                    }
                    discovery = new DatagramSocket(null);
                    discovery.setReuseAddress(true);
                    discovery.bind(new java.net.InetSocketAddress("0.0.0.0", DISCOVERY_PORT));
                    final DatagramSocket udp = discovery;
                    workers.execute(() -> discoveryLoop(udp));
                } catch (Exception e) {
                    // Signaling still works; automatic discovery can be retried by address.
                    discovery = null;
                }
                try {
                    stun = new DatagramSocket(null);
                    stun.setReuseAddress(true);
                    stun.bind(new java.net.InetSocketAddress("0.0.0.0", STUN_PORT));
                    final DatagramSocket stunSocket = stun;
                    workers.execute(() -> stunLoop(stunSocket));
                } catch (Exception e) {
                    stun = null;
                }
            }
            JSObject result = new JSObject();
            result.put("host", getLanAddress());
            result.put("port", port);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("无法启动安卓局域网信令服务: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public synchronized void stop(PluginCall call) {
        closeServers();
        call.resolve();
    }

    private synchronized void closeServers() {
        try { if (server != null) server.close(); } catch (Exception ignored) { }
        try { if (discovery != null) discovery.close(); } catch (Exception ignored) { }
        try { if (stun != null) stun.close(); } catch (Exception ignored) { }
        try { if (multicastLock != null && multicastLock.isHeld()) multicastLock.release(); } catch (Exception ignored) { }
        server = null;
        discovery = null;
        stun = null;
        multicastLock = null;
        clients.clear();
    }

    @Override
    protected void handleOnDestroy() {
        closeServers();
        workers.shutdownNow();
        super.handleOnDestroy();
    }

    private String getLanAddress() {
        try {
            Enumeration<NetworkInterface> nics = NetworkInterface.getNetworkInterfaces();
            for (NetworkInterface nic : Collections.list(nics)) {
                if (!nic.isUp() || nic.isLoopback()) continue;
                if (!nic.getName().startsWith("wlan")) continue;
                for (InetAddress addr : Collections.list(nic.getInetAddresses())) {
                    if (!addr.isLoopbackAddress() && addr.getHostAddress().indexOf(':') < 0) return addr.getHostAddress();
                }
            }
            for (NetworkInterface nic : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nic.isUp() || nic.isLoopback()) continue;
                for (InetAddress addr : Collections.list(nic.getInetAddresses())) {
                    if (!addr.isLoopbackAddress() && addr.getHostAddress().indexOf(':') < 0) return addr.getHostAddress();
                }
            }
        } catch (Exception ignored) { }
        return "127.0.0.1";
    }

    private void stunLoop(DatagramSocket socket) {
        byte[] buffer = new byte[576];
        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
        while (!socket.isClosed()) {
            try {
                packet.setLength(buffer.length);
                socket.receive(packet);
                byte[] response = stunResponse(packet);
                if (response == null) continue;
                socket.send(new DatagramPacket(response, response.length, packet.getAddress(), packet.getPort()));
            } catch (SocketException e) {
                return;
            } catch (Exception ignored) { }
        }
    }

    private static byte[] stunResponse(DatagramPacket packet) {
        byte[] data = packet.getData();
        int offset = packet.getOffset();
        int len = packet.getLength();
        if (len < 20 || data[offset] != 0 || data[offset + 1] != 1) return null;
        if ((data[offset + 4] & 0xff) != 0x21 || (data[offset + 5] & 0xff) != 0x12
                || (data[offset + 6] & 0xff) != 0xa4 || (data[offset + 7] & 0xff) != 0x42) return null;
        if (!(packet.getAddress() instanceof Inet4Address)) return null;
        byte[] ip = packet.getAddress().getAddress();
        int port = packet.getPort() & 0xffff;
        int xorPort = port ^ 0x2112;
        byte[] out = new byte[44];
        out[0] = 0x01;
        out[1] = 0x01;
        out[3] = 24;
        out[4] = 0x21;
        out[5] = 0x12;
        out[6] = (byte) 0xa4;
        out[7] = 0x42;
        System.arraycopy(data, offset + 8, out, 8, 12);
        out[21] = 0x20;
        out[23] = 8;
        out[25] = 1;
        out[26] = (byte) ((xorPort >> 8) & 0xff);
        out[27] = (byte) (xorPort & 0xff);
        out[28] = (byte) ((ip[0] & 0xff) ^ 0x21);
        out[29] = (byte) ((ip[1] & 0xff) ^ 0x12);
        out[30] = (byte) ((ip[2] & 0xff) ^ 0xa4);
        out[31] = (byte) ((ip[3] & 0xff) ^ 0x42);
        out[33] = 0x01;
        out[35] = 8;
        out[37] = 1;
        out[38] = (byte) ((port >> 8) & 0xff);
        out[39] = (byte) (port & 0xff);
        out[40] = ip[0];
        out[41] = ip[1];
        out[42] = ip[2];
        out[43] = ip[3];
        return out;
    }

    private void discoveryLoop(DatagramSocket udp) {
        byte[] buffer = new byte[512];
        while (!udp.isClosed()) {
            try {
                DatagramPacket request = new DatagramPacket(buffer, buffer.length);
                udp.receive(request);
                String probe = new String(request.getData(), request.getOffset(), request.getLength(), StandardCharsets.UTF_8).trim();
                if (!PROBE.equals(probe)) continue;
                JSONObject reply = new JSONObject();
                reply.put("app", "pokerogue-lan");
                reply.put("httpPort", port);
                reply.put("stunPort", STUN_PORT);
                reply.put("name", "安卓房主");
                reply.put("signalPath", "/peerjs");
                JSONArray rooms = new JSONArray();
                for (String id : clients.keySet()) {
                    if (id != null && id.regionMatches(true, 0, "pokerogue-", 0, 10) && id.length() > 10) {
                        rooms.put(id.substring(10).toUpperCase());
                    }
                }
                reply.put("rooms", rooms);
                byte[] bytes = reply.toString().getBytes(StandardCharsets.UTF_8);
                udp.send(new DatagramPacket(bytes, bytes.length, request.getAddress(), request.getPort()));
            } catch (SocketException e) {
                return;
            } catch (Exception ignored) { }
        }
    }

    private void acceptLoop(ServerSocket listener) {
        while (!listener.isClosed()) {
            try {
                Socket socket = listener.accept();
                socket.setTcpNoDelay(true);
                workers.execute(() -> handleSocket(socket));
            } catch (SocketException e) {
                return;
            } catch (Exception ignored) { }
        }
    }

    private void handleSocket(Socket socket) {
        Client client = null;
        try {
            socket.setSoTimeout(0);
            InputStream in = new BufferedInputStream(socket.getInputStream());
            OutputStream out = new BufferedOutputStream(socket.getOutputStream());
            String request = readHeaders(in);
            if (request == null) return;
            String[] lines = request.split("\r\n");
            String[] first = lines[0].split(" ");
            if (first.length < 2) return;
            String target = first[1];
            if ("OPTIONS".equals(first[0])) {
                out.write(("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Max-Age: 600\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                out.flush(); return;
            }
            if ("GET".equals(first[0]) && target.startsWith("/peerjs/peerjs/id")) {
                byte[] id = UUID.randomUUID().toString().replace("-", "").getBytes(StandardCharsets.UTF_8);
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\nCache-Control: no-store\r\nContent-Length: " + id.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                out.write(id); out.flush(); return;
            }
            String wsKey = header(lines, "sec-websocket-key");
            if (!target.startsWith("/peerjs/peerjs?") || wsKey == null) return;
            String accept = Base64.encodeToString(MessageDigest.getInstance("SHA-1").digest((wsKey + WS_GUID).getBytes(StandardCharsets.US_ASCII)), Base64.NO_WRAP);
            out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII)); out.flush();
            Map<String, String> q = parseQuery(target.substring(target.indexOf('?') + 1));
            if (!"peerjs".equals(q.get("key")) || q.get("id") == null) { send(out, "INVALID-KEY", null, null, null); return; }
            String id = q.get("id"), token = q.getOrDefault("token", "");
            Client old = clients.get(id);
            if (old != null && !old.token.equals(token)) { send(out, "ID-TAKEN", null, null, new JSONObject().put("msg", "ID already taken")); return; }
            if (old != null) old.close();
            client = new Client(id, token, socket, out);
            clients.put(id, client);
            client.send(new JSONObject().put("type", "OPEN"));
            readWebSocket(in, client);
        } catch (Exception ignored) {
        } finally {
            if (client != null) disconnect(client);
            try { socket.close(); } catch (Exception ignored) { }
        }
    }

    private void disconnect(Client c) {
        if (clients.remove(c.id, c)) {
            for (Client other : clients.values()) {
                try { other.send(new JSONObject().put("type", "LEAVE").put("src", c.id).put("dst", other.id)); } catch (Exception ignored) { }
            }
        }
    }

    private void readWebSocket(InputStream in, Client source) throws Exception {
        while (!source.socket.isClosed()) {
            int a = in.read(), b = in.read();
            if (a < 0 || b < 0) return;
            int opcode = a & 0x0f;
            long len = b & 0x7f;
            if (len == 126) len = readUnsigned(in, 2);
            else if (len == 127) len = readUnsigned(in, 8);
            if (len > 2_000_000) return;
            byte[] mask = (b & 0x80) != 0 ? readExact(in, 4) : null;
            byte[] data = readExact(in, (int)len);
            if (mask != null) for (int i=0; i<data.length; i++) data[i] ^= mask[i & 3];
            if (opcode == 8) return;
            if (opcode == 9) { source.writeFrame(10, data); continue; }
            if (opcode != 1) continue;
            JSONObject msg;
            try { msg = new JSONObject(new String(data, StandardCharsets.UTF_8)); } catch (Exception e) { continue; }
            String type = msg.optString("type", "");
            String dst = msg.optString("dst", "");
            if ("HEARTBEAT".equals(type) || dst.isEmpty()) continue;
            Client target = clients.get(dst);
            if (target == null) source.send(new JSONObject().put("type", "EXPIRE").put("src", dst).put("dst", source.id));
            else target.send(new JSONObject().put("type", type).put("src", source.id).put("dst", dst).put("payload", msg.opt("payload")));
        }
    }

    private static String readHeaders(InputStream in) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int state = 0, x;
        while ((x = in.read()) >= 0 && bytes.size() < 16384) {
            bytes.write(x);
            if ((state == 0 && x == '\r') || (state == 2 && x == '\r')) state++;
            else if ((state == 1 && x == '\n') || (state == 3 && x == '\n')) state++;
            else state = 0;
            if (state == 4) return bytes.toString("US-ASCII");
        }
        return null;
    }
    private static String header(String[] lines, String name) {
        for (String line : lines) if (line.toLowerCase().startsWith(name + ":")) return line.substring(line.indexOf(':')+1).trim();
        return null;
    }
    private static Map<String,String> parseQuery(String query) throws Exception {
        Map<String,String> result = new ConcurrentHashMap<>();
        for (String part : query.split("&")) { String[] kv=part.split("=",2); result.put(java.net.URLDecoder.decode(kv[0], "UTF-8"), kv.length>1?java.net.URLDecoder.decode(kv[1], "UTF-8"):""); }
        return result;
    }
    private static long readUnsigned(InputStream in, int n) throws Exception { long v=0; for(int i=0;i<n;i++){int b=in.read(); if(b<0)throw new java.io.EOFException(); v=(v<<8)|(b&255);} return v; }
    private static byte[] readExact(InputStream in, int n) throws Exception { byte[] b=new byte[n]; int p=0; while(p<n){int k=in.read(b,p,n-p); if(k<0)throw new java.io.EOFException(); p+=k;} return b; }
    private static void send(OutputStream out,String type,String src,String dst,JSONObject payload) throws Exception { JSONObject o=new JSONObject().put("type",type); if(src!=null)o.put("src",src); if(dst!=null)o.put("dst",dst); if(payload!=null)o.put("payload",payload); byte[] b=o.toString().getBytes(StandardCharsets.UTF_8); out.write(0x81); if(b.length<126)out.write(b.length); else {out.write(126);out.write((b.length>>>8)&255);out.write(b.length&255);} out.write(b); out.flush(); }

    private static class Client {
        final String id, token; final Socket socket; final OutputStream out;
        Client(String id,String token,Socket socket,OutputStream out){this.id=id;this.token=token;this.socket=socket;this.out=out;}
        synchronized void send(JSONObject msg) throws Exception { byte[] b=msg.toString().getBytes(StandardCharsets.UTF_8); writeFrame(1,b); }
        synchronized void writeFrame(int opcode,byte[] b) throws Exception { out.write(0x80|opcode); if(b.length<126)out.write(b.length); else {out.write(126);out.write((b.length>>>8)&255);out.write(b.length&255);} out.write(b);out.flush(); }
        void close(){try{socket.close();}catch(Exception ignored){}}
    }
}
