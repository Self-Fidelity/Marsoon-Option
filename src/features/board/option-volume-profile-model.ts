import type { OptionVolumeProfileResponse } from "@/api/options";

export interface OptionVolumeProfileRow {
  strike: number;
  callVolume: number;
  putVolume: number;
}

export interface OptionVolumeProfileModel {
  rows: OptionVolumeProfileRow[];
  snapshotUnix: number;
  isFallback?: boolean;
}

/**
 * Current-session 0DTE option contracts by strike. Missing volume remains
 * missing; only strikes with an observed trade are rendered.
 */
export function buildOptionVolumeProfileModel(response: OptionVolumeProfileResponse): OptionVolumeProfileModel {
  const rows = (response.rows ?? [])
    .filter((row) => Number.isFinite(row.strike) && (row.call_volume > 0 || row.put_volume > 0))
    .map((row) => ({
      strike: row.strike,
      callVolume: Math.max(0, row.call_volume),
      putVolume: Math.max(0, row.put_volume),
    }))
    .sort((a, b) => b.strike - a.strike);
  return {
    rows,
    snapshotUnix: response.source_to || response.to,
    isFallback: response.fallback,
  };
}
