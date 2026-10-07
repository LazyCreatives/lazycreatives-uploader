import { describe, it, expect } from "vitest";
// @ts-ignore - the preload script read as plain text
import src from "../electron/preload.js?raw";

// The Windows title strip (TitleBar in Desktop.tsx) only shows when the page knows it is
// on Windows. Without it the window has nothing to drag it by (fixed in 0.2.3).
describe("preload", () => {
  it("tells the page which system it is on", () => {
    expect(src as string).toMatch(/platform:\s*process\.platform/);
    expect(src as string).toMatch(/openAppMenu:/);
  });
});
