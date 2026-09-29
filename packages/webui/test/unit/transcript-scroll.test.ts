import { describe, expect, it } from "vitest";
import {
  WEBUI_SCROLL_FOLLOW_THRESHOLD_PX,
  webuiScrollBottomTop,
  webuiScrollFollowsBottom,
} from "../../src/client/projection/transcript-scroll.js";

describe("transcript scroll geometry", () => {
  it("pins the viewport to the last message", () => {
    expect(
      webuiScrollBottomTop({ scrollTop: 0, scrollHeight: 4200, clientHeight: 800 }),
    ).toBe(3400);
  });

  it("clamps to the top when the transcript is shorter than the viewport", () => {
    expect(
      webuiScrollBottomTop({ scrollTop: 0, scrollHeight: 500, clientHeight: 800 }),
    ).toBe(0);
  });

  it("treats the near-bottom band as following", () => {
    const bottom = webuiScrollBottomTop({
      scrollTop: 0,
      scrollHeight: 4200,
      clientHeight: 800,
    });
    expect(
      webuiScrollFollowsBottom({
        scrollTop: bottom - WEBUI_SCROLL_FOLLOW_THRESHOLD_PX,
        scrollHeight: 4200,
        clientHeight: 800,
      }),
    ).toBe(true);
    expect(
      webuiScrollFollowsBottom({
        scrollTop: bottom - WEBUI_SCROLL_FOLLOW_THRESHOLD_PX - 1,
        scrollHeight: 4200,
        clientHeight: 800,
      }),
    ).toBe(false);
  });

  it("reads an unfilled viewport as following so an empty session never unfollows", () => {
    expect(
      webuiScrollFollowsBottom({ scrollTop: 0, scrollHeight: 120, clientHeight: 800 }),
    ).toBe(true);
  });
});
