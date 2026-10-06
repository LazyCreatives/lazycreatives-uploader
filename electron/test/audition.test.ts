import { describe, it, expect } from "vitest";
import { auditionOn, setAudition } from "../src/audition";

describe("preview on hover", () => {
  it("is off until switched on, and remembers the switch", () => {
    expect(auditionOn()).toBe(false);
    setAudition(true);
    expect(auditionOn()).toBe(true);
    expect(localStorage.getItem("lc-audition")).toBe("true");
    setAudition(false);
    expect(localStorage.getItem("lc-audition")).toBe("false");
  });
});
