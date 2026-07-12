/** Size native <select> to longest option text + current padding (includes arrow). */
export function fitSelectWidth(el: HTMLSelectElement): void {
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const font = cs.font && cs.font !== "0px serif" ? cs.font : `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.font = font;
  let max = 0;
  for (const opt of Array.from(el.options)) {
    const w = ctx.measureText(opt.textContent || opt.label || opt.value || "").width;
    if (w > max) max = w;
  }
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const border = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
  const width = Math.ceil(max + padL + padR + border + 2);
  el.style.width = `${Math.max(width, 48)}px`;
  el.style.maxWidth = "100%";
  el.style.minWidth = "0";
  el.style.flex = "0 0 auto";
}

export function fitAllSelects(root: ParentNode = document): void {
  root.querySelectorAll("select").forEach((node) => {
    if (node instanceof HTMLSelectElement) fitSelectWidth(node);
  });
}

export function installFitSelects(): () => void {
  let raf = 0;
  const run = () => fitAllSelects(document);
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      run();
    });
  };
  run();
  const mo = new MutationObserver(schedule);
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "value"],
  });
  window.addEventListener("resize", schedule);
  return () => {
    mo.disconnect();
    window.removeEventListener("resize", schedule);
    if (raf) cancelAnimationFrame(raf);
  };
}
