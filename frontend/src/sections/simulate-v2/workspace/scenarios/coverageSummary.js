import { perAxisCoverage, pairwiseCoverage, forcedCellsCoverage } from "../../_mock/coverage";

/*
  The three numbers the Coverage drawer leads with — Axes, Pairs, Forced —
  computed the same way CoverageMatrix does, so the toolbar button's hover
  and the drawer's header never disagree.
*/
export function coverageSummary(scenarios, env) {
  const perAxis = perAxisCoverage(scenarios, env);
  const pairs = pairwiseCoverage(scenarios, env);
  const forced = forcedCellsCoverage(scenarios);
  const axes = perAxis.length ? perAxis.reduce((sum, a) => sum + a.ratio, 0) / perAxis.length : 0;
  const pairAvg = pairs.length ? pairs.reduce((sum, p) => sum + p.ratio, 0) / pairs.length : 0;
  const forcedHit = forced.filter((f) => f.present).length;
  return {
    axes: `${Math.round(axes * 100)}%`,
    pairs: `${Math.round(pairAvg * 100)}%`,
    forced: `${forcedHit}/${forced.length}`,
  };
}
