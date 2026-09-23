// TranscriptSkeletons — WebUI transcription of `function c()` and `function u()`
// from `mine-transcript/58686.pretty.js` (lines 23310 and 23342). Used as the
// first-paint placeholder when the transcript viewport is still loading
// history; the desktop shows `chat-skeleton` for ongoing sessions and
// `greeting-skeleton` for fresh / no-history cases.
//
// The line widths are lifted verbatim from Desktop's `i` and `l` arrays
// (lines 23297–23298) and the gradient mask is copied from Desktop's `s`
// constant (lines 23299–23302) into `transcript-widgets.css`'s
// `@keyframes transcript-shimmer` + `.animate-shimmer` rule.
//
// `34890.O` from Desktop is just the shimmer background colour rectangle —
// `--shimmer-duration` is set by the CSS file at the body level so the
// animation interval stays in lockstep with the rest of the WebUI shell.

import type { CSSProperties } from "react";

const LINE_WIDTHS: readonly string[] = [
  "76%",
  "53%",
  "63%",
  "35%",
  "53%",
  "35%",
  "73%",
  "53%",
];

const SECONDARY_WIDTHS: readonly string[] = ["76%", "53%", "63%", "35%"];

const gradientMask: CSSProperties = {
  maskImage: "linear-gradient(180deg, black 0%, transparent 100%)",
  WebkitMaskImage: "linear-gradient(180deg, black 0%, transparent 100%)",
};

const shimmerBase = {
  background: "var(--bg_default_tertiary)",
};

function ShimmerBar(props: { width: string | number; height: number; rounded?: string }): React.JSX.Element {
  const { width, height, rounded = "0.5rem" } = props;
  return (
    <div
      className="animate-shimmer"
      style={{
        ...shimmerBase,
        width,
        height,
        borderRadius: rounded,
      }}
    />
  );
}

export function ChatSkeleton(): React.JSX.Element {
  return (
    <div className="flex-1 overflow-hidden" data-testid="chat-skeleton">
      <div className="max-w-[768px] mx-auto">
        <div className="flex justify-end">
          <ShimmerBar width={280} height={48} rounded="1rem" />
        </div>
        <div className="mt-5">
          <div className="flex flex-col gap-[5px]">
            {LINE_WIDTHS.map((width, index) => (
              <ShimmerBar key={`a${index}`} width={width} height={22} />
            ))}
          </div>
          <div className="mt-2 flex flex-col gap-2" style={gradientMask}>
            {SECONDARY_WIDTHS.map((width, index) => (
              <ShimmerBar key={`b${index}`} width={width} height={24} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GreetingSkeleton(): React.JSX.Element {
  return (
    <div className="flex-1 overflow-hidden" data-testid="greeting-skeleton">
      <div className="max-w-[768px] mx-auto">
        <ShimmerBar width={40} height={40} rounded="9999px" />
        <div className="mt-4">
          <div className="flex flex-col gap-[5px]">
            {LINE_WIDTHS.map((width, index) => (
              <ShimmerBar key={`a${index}`} width={width} height={22} />
            ))}
          </div>
          <div className="mt-2 flex flex-col gap-2" style={gradientMask}>
            {SECONDARY_WIDTHS.map((width, index) => (
              <ShimmerBar key={`b${index}`} width={width} height={24} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}