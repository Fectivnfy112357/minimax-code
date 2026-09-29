// transcript-scroll — 会话转录视口的滚动策略。
//
// 视口 `[data-webui-session-scroll="true"]` 承载整条消息流：live 回合期间由自动跟随
// 维持贴底，进入一个非 live 会话时同样要落在最后一条消息上。这里的函数只做纯计算，
// 把"何时跳"和"跳多远"从组件里拆出来，状态迁移可以直接单测。

/** 视口距底部小于该距离即视为贴底（px）。 */
export const WEBUI_SCROLL_FOLLOW_THRESHOLD_PX = 150;

export interface WebuiScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** 贴底所需的 scrollTop；内容不足一屏时为 0。 */
export function webuiScrollBottomTop(metrics: WebuiScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}

/** 视口当前是否处于跟随贴底的位置。 */
export function webuiScrollFollowsBottom(metrics: WebuiScrollMetrics): boolean {
  return (
    webuiScrollBottomTop(metrics) - metrics.scrollTop
      <= WEBUI_SCROLL_FOLLOW_THRESHOLD_PX
  );
}
