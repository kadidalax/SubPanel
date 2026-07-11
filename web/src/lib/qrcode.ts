// Local QR generation (no third-party URL leak).
// kazuhikoarase/qrcode-generator (MIT)
// @ts-ignore
import * as qrMod from "./qrcode-generator.js";

type QrInst = {
  addData: (data: string) => void;
  make: () => void;
  getModuleCount: () => number;
  isDark: (row: number, col: number) => boolean;
};
type QrFn = (typeNumber: number, errorCorrectionLevel: string) => QrInst;

function resolveQr(): QrFn {
  const m: any = qrMod as any;
  if (typeof m === "function") return m;
  if (typeof m?.default === "function") return m.default;
  if (typeof m?.qrcode === "function") return m.qrcode;
  throw new Error("qrcode lib missing");
}

const qrcode = resolveQr();

export function qrDataUrl(text: string, size = 168): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / (count + 2);
  let rects = "";
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (qr.isDark(y, x)) {
        rects += `<rect x="${((x + 1) * cell).toFixed(3)}" y="${((y + 1) * cell).toFixed(3)}" width="${(cell + 0.05).toFixed(3)}" height="${(cell + 0.05).toFixed(3)}" fill="#111"/>`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/>${rects}</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
