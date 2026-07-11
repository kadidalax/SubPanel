declare function qrcode(typeNumber: number, errorCorrectionLevel: string): {
  addData: (data: string) => void;
  make: () => void;
  getModuleCount: () => number;
  isDark: (row: number, col: number) => boolean;
};
declare const _default: typeof qrcode;
export default _default;
