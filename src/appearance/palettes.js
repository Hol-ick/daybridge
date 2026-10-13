export const APPEARANCE_KEY = "daybridge.appearance.v1";
// Canvas, cards, ink, accent and writing paper travel together.
export const PALETTES = [
  { id: "midnight", label: "미드나잇", mode: "dark", canvas: "#18212b", surface: "#202c38", raised: "#2a3947", field: "#121b24", ink: "#e9f0f5", muted: "#a7b9c8", line: "#405365", accent: "#9ac9ef", onAccent: "#142536", paper: "#e6eef4", paperInk: "#253c50" },
  { id: "ocean", label: "딥 오션", mode: "dark", canvas: "#152a2e", surface: "#1d363b", raised: "#29464b", field: "#102125", ink: "#e4f2ef", muted: "#9ebfba", line: "#456662", accent: "#91d8c9", onAccent: "#14352e", paper: "#e5f1eb", paperInk: "#29483d" },
  { id: "plum", label: "플럼", mode: "dark", canvas: "#292332", surface: "#352e40", raised: "#443a50", field: "#211b29", ink: "#f2eaf6", muted: "#beb0cd", line: "#62536f", accent: "#cfb5e9", onAccent: "#322342", paper: "#efe7f3", paperInk: "#493651" },
  { id: "paper", label: "라이트 페이퍼", mode: "light", canvas: "#f2f4f8", surface: "#ffffff", raised: "#e6ebf2", field: "#f6f8fb", ink: "#28384a", muted: "#596b7e", line: "#c0ccd9", accent: "#365e91", onAccent: "#ffffff", paper: "#ffffff", paperInk: "#28384a" },
  { id: "sage", label: "세이지", mode: "light", canvas: "#e9efea", surface: "#f8fbf7", raised: "#dae6dc", field: "#f1f6ef", ink: "#2e4438", muted: "#566c5e", line: "#b6c9bc", accent: "#3c6c55", onAccent: "#ffffff", paper: "#fcfcf5", paperInk: "#344739" },
  { id: "rose", label: "로즈", mode: "light", canvas: "#f3ebee", surface: "#fff9fb", raised: "#eddee5", field: "#faf3f6", ink: "#4c3541", muted: "#795d6c", line: "#d5bcc8", accent: "#92516f", onAccent: "#ffffff", paper: "#fffaf8", paperInk: "#4c3541" },
];
/** @param {unknown} value */
export function normalizeAppearance(value) {
  const candidate = value && typeof value === "object" ? value : {};
  const id = "paletteId" in candidate ? candidate.paletteId : undefined;
  const legacy = "accent" in candidate ? candidate.accent : undefined;
  const palette = PALETTES.find(p => p.id === id)
    || PALETTES.find(p => p.id === ({ "#62dca5": "ocean", "#7c9cff": "midnight", "#dd8aff": "plum" }[String(legacy)]))
    || PALETTES[0];
  return { paletteId: palette.id };
}
/** @param {unknown} value */
export function paletteFor(value) { return PALETTES.find(p => p.id === normalizeAppearance(value).paletteId) || PALETTES[0]; }
