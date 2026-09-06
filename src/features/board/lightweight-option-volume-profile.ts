import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";

import type { OptionVolumeProfileRow } from "./option-volume-profile-model";
import { profileBinHeight } from "./lightweight-profile-bins";

/** Current-session 0DTE option volume, split by Call and Put at each strike. */
export class OptionVolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private attachedTo?: SeriesAttachedParameter<Time>;
  private rows: OptionVolumeProfileRow[] = [];
  private width = 180;
  private rightInset = 0;
  private tickSize = 1;
  private colors = { buy: "", sell: "", text: "", border: "" };
  private views: IPrimitivePaneView[] = [{ zOrder: () => "top", renderer: () => ({ draw: (target) => this.draw(target) }) }];

  attached(parameters: SeriesAttachedParameter<Time>) { this.attachedTo = parameters; }
  detached() { this.attachedTo = undefined; }
  paneViews() { return this.views; }

  configure(rows: OptionVolumeProfileRow[], width: number, rightInset: number, tickSize: number, colors: typeof this.colors) {
    this.rows = rows.filter((row) => Number.isFinite(row.strike) && Number.isFinite(row.callVolume) && Number.isFinite(row.putVolume));
    this.width = width;
    this.rightInset = Math.max(0, rightInset);
    this.tickSize = tickSize;
    this.colors = colors;
    this.attachedTo?.requestUpdate();
  }

  private draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]) {
    if (!this.attachedTo || !this.rows.length) return;
    const series = this.attachedTo.series;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const right = Math.max(1, mediaSize.width - this.rightInset);
      const width = Math.min(this.width, right * 0.5);
      const left = Math.max(0, right - width);
      const center = left + width / 2;
      const half = Math.max(1, width / 2 - 7);
      const visible = this.rows.flatMap((row) => {
        const y = series.priceToCoordinate(row.strike);
        return y === null || y < 18 || y > mediaSize.height ? [] : [{ row, y }];
      });
      const visibleMax = Math.max(1, ...visible.flatMap(({ row }) => [row.callVolume, row.putVolume]));

      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.colors.border;
      ctx.fillRect(center, 18, 1, mediaSize.height - 18);
      ctx.font = "10px sans-serif";
      ctx.fillStyle = this.colors.text;
      ctx.textAlign = "center";
      ctx.fillText("OPT VOL", center, 12);
      for (let i = 0; i < visible.length; i++) {
        const { row, y } = visible[i]!;
        const height = profileBinHeight(row.strike, this.tickSize, (price) => series.priceToCoordinate(price));
        ctx.globalAlpha = .82;
        ctx.fillStyle = this.colors.buy;
        ctx.fillRect(center + 1, y - height / 2, row.callVolume / visibleMax * half, height);
        ctx.fillStyle = this.colors.sell;
        const putWidth = row.putVolume / visibleMax * half;
        ctx.fillRect(center - putWidth, y - height / 2, putWidth, height);
      }
      ctx.restore();
    });
  }
}
