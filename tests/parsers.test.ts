import test from "node:test";
import assert from "node:assert/strict";
import { parseSubscriptionText } from "../src/parsers/detect.ts";
import { renderProfile } from "../src/renderers/index.ts";
import { assertSafeRemoteUrl, parseUserinfo } from "../src/services/ssrf.ts";

test("parse vless and ss uri list", () => {
  const text = [
    "vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=reality&sni=example.com&fp=chrome&pbk=PUBLIC&sid=abcd&type=tcp#vless-node",
    "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8388#ss-node",
  ].join(String.fromCharCode(10));
  const parsed = parseSubscriptionText(text);
  assert.equal(parsed.nodes.length, 2);
  assert.equal(parsed.nodes[0].protocol, "vless");
  assert.equal(parsed.nodes[1].protocol, "ss");
});

test("render mihomo and uri", () => {
  const parsed = parseSubscriptionText("trojan://password@example.com:443?sni=example.com#trojan-node");
  const mihomo = renderProfile("mihomo", parsed.nodes);
  assert.match(mihomo.body, /type: trojan/);
  const uri = renderProfile("uri", parsed.nodes);
  assert.match(uri.body, /trojan:\/\//);
});

test("ssrf blocks private hosts", () => {
  assert.throws(() => assertSafeRemoteUrl("https://127.0.0.1/sub"));
  assert.throws(() => assertSafeRemoteUrl("http://example.com/sub"));
  assert.doesNotThrow(() => assertSafeRemoteUrl("https://example.com/sub"));
});

test("parse subscription-userinfo", () => {
  const info = parseUserinfo("upload=1; download=2; total=3; expire=1710000000");
  assert.equal(info.upload, 1);
  assert.equal(info.download, 2);
  assert.equal(info.total, 3);
  assert.equal(info.expire, 1710000000 * 1000);
});


test("render uri-base64", () => {
  const parsed = parseSubscriptionText("trojan://password@example.com:443?sni=example.com#trojan-node");
  const b64 = renderProfile("uri-base64", parsed.nodes);
  assert.equal(b64.skipped.length, 0);
  const decoded = Buffer.from(b64.body, "base64").toString("utf8");
  assert.match(decoded, /trojan:\/\//);
  assert.equal(b64.contentType, "text/plain; charset=utf-8");
});

test("normalizeDeliveryFormat accepts uri-base64", async () => {
  const { normalizeDeliveryFormat } = await import("../src/renderers/index.ts");
  assert.deepEqual(normalizeDeliveryFormat("uri-base64"), { format: "uri-base64", fallback: false });
  assert.deepEqual(normalizeDeliveryFormat("unknown"), { format: "uri", fallback: true });
});


test("v2rayn hysteria2 imports certificate and rebuilds uri", () => {
  const payload = Buffer.from(JSON.stringify({
    Address: "1.2.3.4",
    Port: 443,
    Password: "secret",
    Sni: "example.com",
    AllowInsecure: "false",
    Cert: "-----BEGIN CERT-----\nABC\n-----END CERT-----",
    Remarks: "hy2-cert",
    ProtoExtraObj: { Ports: "50000-51000" },
  })).toString("base64");
  const raw = "v2rayn://hysteria2/" + payload;
  const parsed = parseSubscriptionText(raw);
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, "hysteria2");
  const mihomo = renderProfile("mihomo", parsed.nodes);
  assert.match(mihomo.body, /ca-str/);
  assert.match(mihomo.body, /ports/);
  const uri = renderProfile("uri", parsed.nodes);
  // keep v2rayn raw when Cert exists — clients need the original wrapper for certificates
  assert.match(uri.body, /v2rayn:\/\/hysteria2\//);
  assert.match(uri.body, /hysteria2|v2rayn/);
  const mihomo2 = renderProfile("mihomo", parsed.nodes);
  assert.match(mihomo2.body, /ca-str/);
});

test("vless reality renders into mihomo", () => {
  const raw = "vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=reality&sni=example.com&fp=chrome&pbk=PUBLICKEY&sid=abcd&type=tcp#reality-node";
  const parsed = parseSubscriptionText(raw);
  assert.equal(parsed.nodes[0].protocol, "vless");
  const mihomo = renderProfile("mihomo", parsed.nodes);
  assert.match(mihomo.body, /reality-opts/);
  assert.match(mihomo.body, /publicKey: PUBLICKEY/);
  const uri = renderProfile("uri", parsed.nodes);
  assert.match(uri.body, /vless:\/\//);
});


test("anytls and naive v2rayn parse and render", () => {
  const anytlsPayload = Buffer.from(JSON.stringify({
    Address: "1.2.3.4", Port: 443, Password: "pwd", Sni: "example.com", Fingerprint: "chrome",
    Remarks: "anytls-node", AllowInsecure: "false", Cert: "CERT"
  })).toString("base64");
  const naivePayload = Buffer.from(JSON.stringify({
    Address: "1.2.3.4", Port: 443, Username: "u", Password: "p", Sni: "example.com",
    Remarks: "naive-quic", AllowInsecure: "false", ProtoExtraObj: { NaiveQuic: true }
  })).toString("base64");
  const text = [
    "v2rayn://anytls/" + anytlsPayload,
    "v2rayn://naive/" + naivePayload,
  ].join(String.fromCharCode(10));
  const parsed = parseSubscriptionText(text);
  assert.equal(parsed.nodes.length, 2);
  assert.equal(parsed.nodes[0].protocol, "anytls");
  assert.equal(parsed.nodes[1].protocol, "naive");
  assert.equal(parsed.nodes[1].extras?.quic, true);
  const mihomo = renderProfile("mihomo", parsed.nodes);
  assert.match(mihomo.body, /type: anytls/);
  assert.match(mihomo.body, /type: naiveproxy/);
  const singbox = renderProfile("singbox", parsed.nodes);
  assert.match(singbox.body, /"type": "anytls"/);
  assert.match(singbox.body, /"type": "naive"/);
  const uri = renderProfile("uri", parsed.nodes);
  // anytls with cert stays as v2rayn wrapper; naive still rebuilds
  assert.match(uri.body, /v2rayn:\/\/anytls\//);
  assert.match(uri.body, /naive\+https:\/\//);
});

test("shadowtls paired singbox json", () => {
  const json = JSON.stringify({
    outbounds: [
      {
        type: "shadowsocks",
        method: "2022-blake3-aes-128-gcm",
        password: "pass",
        detour: "st",
        multiplex: { enabled: true },
      },
      {
        type: "shadowtls",
        tag: "st",
        server: "1.2.3.4",
        server_port: 443,
        version: 3,
        password: "st-pass",
        tls: { enabled: true, server_name: "example.com", utls: { enabled: true, fingerprint: "chrome" } },
      },
    ],
  });
  const parsed = parseSubscriptionText(json);
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, "ss2022");
  assert.ok(parsed.nodes[0].extras?.shadowtls);
  const mihomo = renderProfile("mihomo", parsed.nodes);
  assert.match(mihomo.body, /plugin: shadow-tls/);
  const singbox = renderProfile("singbox", parsed.nodes);
  assert.match(singbox.body, /"type": "shadowtls"/);
  assert.match(singbox.body, /"detour": /);
});


test("wireguard mihomo parse and render", () => {
  const text = [
    "proxies:",
    "  - name: wg1",
    "    type: wireguard",
    "    server: 1.2.3.4",
    "    port: 51820",
    "    ip: 10.0.0.2/32",
    "    private-key: PRIVKEY",
    "    public-key: PUBKEY",
    "    pre-shared-key: PSK",
    "    mtu: 1280",
    "    udp: true",
    "",
  ].join("\n");
  const parsed = parseSubscriptionText(text);
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, "wireguard");
  const mihomo = renderProfile("mihomo", parsed.nodes);
  assert.match(mihomo.body, /type: wireguard/);
  assert.match(mihomo.body, /private-key/);
  const sing = renderProfile("singbox", parsed.nodes);
  assert.match(sing.body, /"type": "wireguard"/);
});

test("hysteria1 uri and mihomo", () => {
  const uri = "hysteria://authpass@5.6.7.8:443?peer=example.com&up=100&down=200&insecure=1#hy1";
  const parsed = parseSubscriptionText(uri);
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, "hysteria");
  const mihomo = renderProfile("mihomo", parsed.nodes);
  assert.match(mihomo.body, /type: hysteria/);
  const out = renderProfile("uri", parsed.nodes);
  assert.match(out.body, /^hysteria:\/\//m);
});


test("emoji and certificate on hysteria2 uri roundtrip", () => {
  const cert = "-----BEGIN CERT-----\\nABC\\n-----END CERT-----";
  const name = "🇺🇸 dartnode hysteria2";
  const raw =
    "hysteria2://secret@1.2.3.4:443?sni=example.com&insecure=0&allowInsecure=0&mport=50000-51000&cert=" +
    encodeURIComponent(cert) +
    "#" +
    encodeURIComponent(name);
  const parsed = parseSubscriptionText(raw);
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].name, name);
  assert.equal(parsed.nodes[0].tls?.certificate, cert);
  const mihomo = renderProfile("mihomo", parsed.nodes);
  assert.match(mihomo.body, /ca-str/);
  assert.match(mihomo.body, /dartnode/);
  const uri = renderProfile("uri", parsed.nodes);
  assert.match(uri.body, /cert=/);
  assert.match(uri.body, /%F0%9F%87%BA%F0%9F%87%B8|🇺🇸/);
});
