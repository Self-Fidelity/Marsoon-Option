import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp } from "lightweight-charts";

import { profileBinHeight } from "./lightweight-profile-bins";
import { optionVolumeHeatmapValue, type OptionVolumeHeatmapModel } from "./option-volume-heatmap-model";

/** Time × strike option-volume heatmap. Bottom z-order keeps candles readable. */
export class OptionVolumeHeatmapPrimitive implements ISeriesPrimitive<Time> {
  private attachedTo?: SeriesAttachedParameter<Time>;
  private model?: OptionVolumeHeatmapModel;
  private tickSize = 1;
  private chartMinutes = 5;
  private colors = { buy: "", sell: "", total: "" };
  private views: IPrimitivePaneView[] = [{ zOrder: () => "bottom", renderer: () => ({ draw: (target) => this.draw(target) }) }];

  attached(parameters: SeriesAttachedParameter<Time>) { this.attachedTo = parameters; }
  detached() { this.attachedTo = undefined; }
  paneViews() { return this.views; }

  configure(model: OptionVolumeHeatmapModel | undefined, tickSize: number, chartMinutes: number, colors: typeof this.colors) {
    this.model = model;
    this.tickSize = tickSize;
    this.chartMinutes = Math.max(1, chartMinutes);
    this.colors = colors;
    this.attachedTo?.requestUpdate();
  }

  private draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]) {
    if (!this.attachedTo || !this.model?.cells.length) return;
    const { chart, series } = this.attachedTo;
    const timeScale = chart.timeScale();
    const chartSpan = this.chartMinutes * 60;
    const heatSpan = this.model.window === "5m" ? 300 : 60;
    const barSpacing = Math.max(1, timeScale.options().barSpacing ?? 6);
    const xOf = (unix: number) => {
      const base = Math.floor(unix / chartSpan) * chartSpan;
      const baseX = timeScale.timeToCoordinate(base as UTCTimestamp);
      if (baseX === null) return null;
      const nextX = timeScale.timeToCoordinate((base + chartSpan) as UTCTimestamp);
      const slot = nextX === null ? barSpacing : nextX - baseX;
      return { x: baseX + (unix - base) / chartSpan * slot, width: Math.max(1, Math.abs(slot) * heatSpan / chartSpan) };
    };
    const model = this.model;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save();
      for (const cell of model.cells) {
        const time = xOf(cell.unix), y = series.priceToCoordinate(cell.strike);
        if (!time || y === null || time.x < -time.width || time.x > mediaSize.width + time.width || y < 0 || y > mediaSize.height) continue;
        const value = optionVolumeHeatmapValue(cell, model.metric);
        if (value === null || value === 0) continue;
        const intensity = model.metric === "ratio" ? Math.min(1, Math.abs(value)) : Math.min(1, Math.abs(value) / model.maxAbs);
        ctx.globalAlpha = .08 + Math.pow(intensity, .72) * .58;
        ctx.fillStyle = model.metric === "total"
          ? this.colors.total
          : model.metric === "put"
            ? this.colors.sell
            : model.metric === "call" || value > 0
              ? this.colors.buy
              : this.colors.sell;
        const height = profileBinHeight(cell.strike, this.tickSize, (price) => series.priceToCoordinate(price));
        ctx.fillRect(time.x - time.width / 2, y - height / 2, time.width, height);
      }
      ctx.restore();
    });
  }
}
