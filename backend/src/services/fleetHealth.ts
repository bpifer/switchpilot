// A single composite "is my fleet healthy?" score for the dashboard, blended
// from reachability, configuration compliance, and open critical alerts. Pure
// and transparent so the number is explainable (and unit-tested).

export interface FleetHealthInput {
  devicesOnline: number;
  devicesTotal: number;
  compliancePassed: number;
  complianceTotal: number;
  openCriticals: number;
}

export interface FleetHealth {
  score: number;                       // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  components: {
    onlinePct: number;                 // reachable %
    compliancePct: number;             // compliance checks passing %
    openCriticals: number;
    criticalPenalty: number;           // points subtracted for open criticals
  };
}

/**
 * score = 50% reachability + 50% compliance, minus a penalty for open critical
 * alerts (5 pts each, capped at 30 so an alert storm can't zero an otherwise
 * healthy fleet). With no devices or no compliance rules the respective
 * component is treated as 100% (nothing known to be wrong).
 */
export function computeFleetHealth(i: FleetHealthInput): FleetHealth {
  const onlinePct = i.devicesTotal > 0 ? (i.devicesOnline / i.devicesTotal) * 100 : 100;
  const compliancePct = i.complianceTotal > 0 ? (i.compliancePassed / i.complianceTotal) * 100 : 100;
  const criticalPenalty = Math.min(Math.max(i.openCriticals, 0) * 5, 30);
  const base = 0.5 * onlinePct + 0.5 * compliancePct;
  const score = Math.max(0, Math.min(100, Math.round(base - criticalPenalty)));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  return {
    score, grade,
    components: {
      onlinePct: Math.round(onlinePct),
      compliancePct: Math.round(compliancePct),
      openCriticals: Math.max(i.openCriticals, 0),
      criticalPenalty,
    },
  };
}
