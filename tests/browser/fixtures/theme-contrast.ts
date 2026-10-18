import type { Page } from "@playwright/test";

// Measure rendered text against its composited solid background. Photographs,
// gradients, disabled controls and decorative/hidden content need visual review.
export async function solidTextContrast(page: Page) {
  return page.evaluate(() => {
    const rgba = (value: string) => {
      const values = value.match(/[\d.]+/g)?.map(Number);
      return values && values.length >= 3
        ? [values[0], values[1], values[2], values[3] ?? 1]
        : null;
    };
    const luminance = (rgb: number[]) =>
      rgb.slice(0, 3).reduce((sum, v, i) => {
        const x = v / 255;
        return (
          sum +
          (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][i]
        );
      }, 0);
    const problems: { text: string; selector: string; ratio: number }[] = [];
    for (const node of document.querySelectorAll<HTMLElement>("body *")) {
      if (
        !Array.from(node.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
        )
      )
        continue;
      if (node.closest('[aria-hidden="true"], :disabled, [inert], .sr-only'))
        continue;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.right < 0)
        continue;
      const style = getComputedStyle(node);
      if (style.visibility !== "visible") continue;
      const fg = rgba(style.color);
      if (!fg) continue;
      let bg = [0, 0, 0, 0];
      let unknown = false;
      for (
        let ancestor: HTMLElement | null = node;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const s = getComputedStyle(ancestor);
        if (Number(s.opacity) < 1) {
          unknown = true;
          break;
        }
        if (s.backgroundImage !== "none") {
          unknown = true;
          break;
        }
        const c = rgba(s.backgroundColor);
        if (!c) {
          unknown = true;
          break;
        }
        const alpha = bg[3] + c[3] * (1 - bg[3]);
        if (alpha > 0)
          bg = [0, 1, 2]
            .map((i) => (bg[i] * bg[3] + c[i] * c[3] * (1 - bg[3])) / alpha)
            .concat(alpha);
        if (bg[3] >= 0.999) break;
      }
      if (unknown || bg[3] < 0.999) continue;
      const rendered = fg
        .slice(0, 3)
        .map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
      const a = luminance(rendered),
        b = luminance(bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 &&
          parseInt(style.fontWeight) >= 700);
      if (ratio + 0.02 < (large ? 3 : 4.5))
        problems.push({
          text: node.textContent!.trim().slice(0, 60),
          selector: `${node.tagName.toLowerCase()}.${Array.from(node.classList).join(".")}`,
          ratio: Math.round(ratio * 100) / 100,
        });
    }
    return problems;
  });
}
