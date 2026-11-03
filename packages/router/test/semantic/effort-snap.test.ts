import { describe, expect, it } from "vitest";
import { effortOptions, snapEffort } from "../../src/semantic/effort-selector.js";

describe("effortOptions", () => {
  it("unions candidate efforts in order, without none or locked top-tier levels", () => {
    const options = effortOptions(
      [
        { supportedEfforts: ["none"] },
        { supportedEfforts: ["low", "medium", "high"] },
        { supportedEfforts: ["low", "medium", "high", "xhigh", "max"] },
      ],
      false,
    );
    expect(options).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("is empty when no candidate has an effort setting", () => {
    expect(effortOptions([{ supportedEfforts: ["none"] }], false)).toEqual([]);
  });

  it("includes top-tier levels only when unlocked", () => {
    expect(effortOptions([{ supportedEfforts: ["high", "max"] }], true)).toEqual(["high", "max"]);
  });
});

describe("snapEffort", () => {
  it("keeps a supported level", () => {
    expect(snapEffort("medium", ["low", "medium", "high"], false)).toBe("medium");
  });

  it("returns none for models without an effort setting", () => {
    expect(snapEffort("high", ["none"], false)).toBe("none");
  });

  it("snaps an unsupported level to the nearest supported one", () => {
    expect(snapEffort("xhigh", ["low", "medium", "high"], false)).toBe("high");
  });

  it("breaks ties toward the higher level", () => {
    expect(snapEffort("medium", ["low", "high"], false)).toBe("high");
  });

  it("never snaps onto a locked top-tier level", () => {
    expect(snapEffort("xhigh", ["high", "max"], false)).toBe("high");
  });

  it("uses the lowest level when no effort was judged", () => {
    expect(snapEffort(undefined, ["low", "medium"], false)).toBe("low");
  });
});
