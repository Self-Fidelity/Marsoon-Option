import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { GammaRow } from "@/features/options/dashboard-view-model";
import { profileBinHeight } from "./lightweight-profile-bins";

/** Current option OI split by Call and Put, using the chart's own price coordinates. */
export class OptionOiProfilePrimitive implements ISeriesPrimitive<Time> {
  private attachedTo?: SeriesAttachedParameter<Time>;
  private rows: GammaRow[] = [];
  private width = 110;
  private tickSize = 1;
  private colors = { buy: "", sell: "", text: "", border: "" };
  private views: IPrimitivePaneView[] = [{ zOrder: () => "top", renderer: () => ({ draw: (target) => this.draw(target) }) }];
  attached(parameters: SeriesAttachedParameter<Time>) { this.attachedTo = parameters; }
  detached() { this.attachedTo = undefined; }
  paneViews() { return this.views; }
  configure(rows: GammaRow[], width: number, tickSize: number, colors: typeof this.colors) {
    this.rows = rows.filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.callOI) && Number.isFinite(r.putOI) && (r.callOI > 0 || r.putOI > 0));
    this.width = width; this.tickSize = tickSize; this.colors = colors;
    this.attachedTo?.requestUpdate();
  }
  private draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]) {
    if (!this.attachedTo || !this.rows.length) return;
    const series = this.attachedTo.series;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const width = Math.min(this.width, mediaSize.width * 0.4);
      const x = mediaSize.width - width, center = x + width / 2, half = Math.max(1, width / 2 - 7);
      const visible = this.rows.flatMap((row) => {
        const y = series.priceToCoordinate(row.strike);
        return y === null || y < 18 || y > mediaSize.height ? [] : [{ row, y }];
      }).sort((a, b) => a.y - b.y);
      const visibleMax = Math.max(1, ...visible.flatMap(({ row }) => [row.callOI, row.putOI]));
      ctx.save(); ctx.globalAlpha = 1;
      ctx.fillStyle = this.colors.border; ctx.fillRect(center, 18, 1, mediaSize.height - 18);
      ctx.font = "10px sans-serif"; ctx.fillStyle = this.colors.text; ctx.textAlign = "center"; ctx.fillText("OPT OI", center, 12);
      for (let i = 0; i < visible.length; i++) {
        const { row, y } = visible[i]!;
        const h = profileBinHeight(row.strike, this.tickSize, (price) => series.priceToCoordinate(price));
        ctx.globalAlpha = .75; ctx.fillStyle = this.colors.buy;
        ctx.fillRect(center + 1, y - h / 2, row.callOI / visibleMax * half, h);
        ctx.fillStyle = this.colors.sell;
        const putWidth = row.putOI / visibleMax * half;
        ctx.fillRect(center - putWidth, y - h / 2, putWidth, h);
      }
      ctx.restore();
    });
  }
}
