// Minimal SMTP client for Workers (cloudflare:sockets). Supports 465 TLS and 587 STARTTLS.
import { connect } from "cloudflare:sockets";
import { assertSafeOutboundHost } from "./ssrf.ts";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
};

export type SmtpMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
};

function b64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

function encodeSubject(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return "=?UTF-8?B?" + b64(s) + "?=";
}

function encodeAddress(email: string, name?: string): string {
  if (!name) return email;
  if (/^[\x20-\x7E]*$/.test(name)) return '"' + name.replace(/"/g, "") + '" <' + email + ">";
  return "=?UTF-8?B?" + b64(name) + "?= <" + email + ">";
}

async function readLine(reader: ReadableStreamDefaultReader<Uint8Array>, buf: { s: string }): Promise<string> {
  const dec = new TextDecoder();
  while (true) {
    const idx = buf.s.indexOf("\n");
    if (idx >= 0) {
      const line = buf.s.slice(0, idx).replace(/\r$/, "");
      buf.s = buf.s.slice(idx + 1);
      return line;
    }
    const { value, done } = await reader.read();
    if (done) throw new Error("SMTP connection closed");
    buf.s += dec.decode(value, { stream: true });
  }
}

async function readReply(reader: ReadableStreamDefaultReader<Uint8Array>, buf: { s: string }): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  while (true) {
    const line = await readLine(reader, buf);
    lines.push(line);
    if (/^\d{3} /.test(line)) return { code: Number(line.slice(0, 3)), lines };
    if (!/^\d{3}-/.test(line) && /^\d{3}/.test(line)) return { code: Number(line.slice(0, 3)), lines };
  }
}

async function expect(reader: ReadableStreamDefaultReader<Uint8Array>, buf: { s: string }, ok: number[]): Promise<void> {
  const r = await readReply(reader, buf);
  if (!ok.includes(r.code)) throw new Error("SMTP " + r.code + ": " + r.lines.join(" | "));
}

async function write(writer: WritableStreamDefaultWriter<Uint8Array>, line: string): Promise<void> {
  await writer.write(new TextEncoder().encode(line + "\r\n"));
}

async function authAndSend(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buf: { s: string },
  cfg: SmtpConfig,
  mail: SmtpMail,
): Promise<void> {
  if (cfg.user && cfg.pass) {
    await write(writer, "AUTH LOGIN");
    await expect(reader, buf, [334]);
    await write(writer, btoa(cfg.user));
    await expect(reader, buf, [334]);
    await write(writer, btoa(cfg.pass));
    await expect(reader, buf, [235]);
  }

  await write(writer, "MAIL FROM:<" + cfg.from + ">");
  await expect(reader, buf, [250]);
  await write(writer, "RCPT TO:<" + mail.to + ">");
  await expect(reader, buf, [250, 251]);
  await write(writer, "DATA");
  await expect(reader, buf, [354]);

  const boundary = "sp_" + crypto.randomUUID().replace(/-/g, "");
  const headers = [
    "From: " + encodeAddress(cfg.from, mail.fromName),
    "To: " + mail.to,
    "Subject: " + encodeSubject(mail.subject),
    "MIME-Version: 1.0",
    "Date: " + new Date().toUTCString(),
    "Message-ID: <" + crypto.randomUUID() + "@subpanel>",
  ];

  let body: string;
  if (mail.html) {
    headers.push('Content-Type: multipart/alternative; boundary="' + boundary + '"');
    body = [
      "--" + boundary,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      mail.text,
      "--" + boundary,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      mail.html,
      "--" + boundary + "--",
      "",
    ].join("\r\n");
  } else {
    headers.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit");
    body = mail.text + "\r\n";
  }

  const payload = (headers.join("\r\n") + "\r\n\r\n" + body).replace(/^\./gm, "..");
  const normalized = payload.replace(/\r?\n/g, "\r\n") + "\r\n.\r\n";
  await writer.write(new TextEncoder().encode(normalized));
  await expect(reader, buf, [250]);
}

export async function sendSmtp(cfg: SmtpConfig, mail: SmtpMail): Promise<void> {
  if (!cfg.host || !cfg.from || !mail.to) throw new Error("SMTP host/from/to required");
  const port = cfg.port || (cfg.secure ? 465 : 587);
  assertSafeOutboundHost(cfg.host, Number(port), [25, 465, 587, 2525]);
  const socket = connect(
    { hostname: cfg.host, port },
    { secureTransport: cfg.secure ? "on" : "starttls", allowHalfOpen: false },
  ) as any;

  let writer = socket.writable.getWriter();
  let reader = socket.readable.getReader();
  const buf = { s: "" };

  try {
    await expect(reader, buf, [220]);
    await write(writer, "EHLO subpanel");
    await expect(reader, buf, [250]);

    if (!cfg.secure && typeof socket.startTls === "function") {
      await write(writer, "STARTTLS");
      await expect(reader, buf, [220]);
      writer.releaseLock();
      reader.releaseLock();
      const secureSocket = socket.startTls();
      writer = secureSocket.writable.getWriter();
      reader = secureSocket.readable.getReader();
      await write(writer, "EHLO subpanel");
      await expect(reader, buf, [250]);
    }

    await authAndSend(writer, reader, buf, cfg, mail);
    await write(writer, "QUIT");
    try { await expect(reader, buf, [221]); } catch { /* ignore */ }
  } finally {
    try { writer.releaseLock(); } catch { /* */ }
    try { reader.releaseLock(); } catch { /* */ }
    try { socket.close(); } catch { /* */ }
  }
}
