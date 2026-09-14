import React, { useState, useMemo, useEffect } from "react";
import { fetchATMs, fetchForecasts, fetchPriority, fetchAnomalies, fetchRoutes, fetchMetrics } from "./api";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ScatterChart, Scatter, ZAxis, ResponsiveContainer, Tooltip, BarChart, Bar, Cell } from "recharts";

const RISK_COLOR = (score) => {
  if (score >= 75) return "#EF4B5F";
  if (score >= 55) return "#F5A623";
  if (score >= 35) return "#F5D923";
  return "#3ED598";
};
const RISK_LABEL = (score) => {
  if (score >= 75) return "Critical";
  if (score >= 55) return "Refill now";
  if (score >= 35) return "Monitor";
  return "Healthy";
};

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="aopt-stat" style={{
      background: "#131C2E", border: "1px solid #232E45", borderRadius: 10,
      padding: "16px 18px", flex: 1, minWidth: 150
    }}>
      <div style={{ fontSize: 11, color: "#8B96AC", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'Inter', sans-serif", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color: accent || "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#5E6980", marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>{sub}</div>}
    </div>
  );
}

function Sparkline({ data, color = "#3ED598", width = 70, height = 24 }) {
  if (!data || data.length === 0) return null;
  const vals = data.map(d => d.predicted_withdrawal);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const pts = vals.map((v, i) => {
    const px = (i / (vals.length - 1)) * width;
    const py = height - ((v - min) / range) * height;
    return `${px},${py}`;
  }).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function CountUp({ value, format, duration = 700 }) {
  const [display, setDisplay] = useState(0);
  React.useEffect(() => {
    let raf, start;
    const step = (ts) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(value * eased);
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format ? format(display) : Math.round(display)}</>;
}

function AlertBanner({ priority, onSelectAtm, onGoToTab }) {
  const urgent = useMemo(() =>
    priority.filter(p => p.days_to_empty < 1 && p.needs_refill)
      .sort((a, b) => a.days_to_empty - b.days_to_empty),
    [priority]
  );
  const [dismissed, setDismissed] = useState(false);
  if (urgent.length === 0 || dismissed) return null;
  return (
    <div style={{
      background: "linear-gradient(90deg, #2A1620 0%, #1C1220 100%)", border: "1px solid #EF4B5F55",
      borderRadius: 10, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 12,
      animation: "aopt-fadein 0.3s ease"
    }}>
      <Pulse score={100} />
      <div style={{ flex: 1, fontSize: 12.5 }}>
        <span style={{ color: "#EF4B5F", fontWeight: 600 }}>{urgent.length} ATM{urgent.length > 1 ? "s" : ""} critical</span>
        <span style={{ color: "#C9A0A8" }}> — will run out of cash within 24h: </span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E8ECF4" }}>
          {urgent.slice(0, 5).map(p => p.atm_id).join(", ")}{urgent.length > 5 ? ` +${urgent.length - 5} more` : ""}
        </span>
      </div>
      <button className="aopt-btn" onClick={() => { onSelectAtm(urgent[0].atm_id); onGoToTab(2); }} style={{
        background: "#131C2E", color: "#EF4B5F", border: "1px solid #EF4B5F55", borderRadius: 6,
        padding: "5px 12px", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap"
      }}>View all →</button>
      <button onClick={() => setDismissed(true)} style={{
        background: "transparent", border: "none", color: "#5E6980", cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1
      }}>×</button>
    </div>
  );
}

function Pulse({ score }) {
  const color = RISK_COLOR(score);
  const speed = score >= 75 ? "0.9s" : score >= 55 ? "1.6s" : score >= 35 ? "2.6s" : "4s";
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 10, height: 10 }}>
      <span style={{
        position: "absolute", width: "100%", height: "100%", borderRadius: "50%",
        background: color, animation: `pulse ${speed} ease-in-out infinite`
      }} />
      <span style={{ position: "relative", width: 10, height: 10, borderRadius: "50%", background: color }} />
    </span>
  );
}

function NetworkMap({ atms, priority, selectedZoneType, onSelectAtm, selectedAtm, routes, showRoutes, highlightVan }) {
  const lats = atms.map(a => a.lat), lons = atms.map(a => a.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const W = 640, H = 460, PAD = 30;
  const x = (lon) => PAD + ((lon - minLon) / (maxLon - minLon)) * (W - 2 * PAD);
  const y = (lat) => H - PAD - ((lat - minLat) / (maxLat - minLat)) * (H - 2 * PAD);

  const priMap = useMemo(() => Object.fromEntries(priority.map(p => [p.atm_id, p])), [priority]);
  const depot = routes.depot;

  // FIX: Add slight jitter to overlapping coordinates so all 40 ATMs are visible
  const jitteredAtms = useMemo(() => {
    const coordMap = {};
    atms.forEach(a => {
      const key = `${a.lat.toFixed(2)},${a.lon.toFixed(2)}`;
      if (!coordMap[key]) coordMap[key] = [];
      coordMap[key].push(a);
    });
    return atms.map(a => {
      const key = `${a.lat.toFixed(2)},${a.lon.toFixed(2)}`;
      const group = coordMap[key];
      if (group.length === 1) return a;
      const idx = group.indexOf(a);
      const angle = (idx / group.length) * 2 * Math.PI;
      const offset = 0.004; // small offset in degrees (~400 meters)
      return { ...a, lat: a.lat + Math.sin(angle) * offset, lon: a.lon + Math.cos(angle) * offset };
    });
  }, [atms]);

  const vanColors = ["#3ED598", "#5DB4F0", "#F5A623", "#C77DFF", "#EF4B5F", "#4ECDC4", "#F5D923"];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: "#0B1220", borderRadius: 10, border: "1px solid #1C2740" }}>
      <defs>
        <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#131C2E" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />

      {showRoutes && routes.vans.map((van, vi) => {
        const pts = [depot, ...van.stops, depot];
        const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.lon)} ${y(p.lat)}`).join(" ");
        const isHi = !highlightVan || highlightVan === van.van_id;
        return <path key={van.van_id} d={path} fill="none" stroke={vanColors[vi % vanColors.length]}
          strokeWidth={isHi && highlightVan ? "2.5" : "1.5"} strokeDasharray="4 3" opacity={isHi ? (highlightVan ? 0.9 : 0.55) : 0.08} />;
      })}

      <g>
        {/* Background pill behind DEPOT text */}
        <rect
          x={x(depot.lon) - 24}
          y={y(depot.lat) - 32}
          width="48"
          height="16"
          rx="4"
          fill="#0B1220"
          stroke="#3ED598"
          strokeWidth="1"
          opacity="0.95"
        />
        {/* DEPOT text inside pill */}
        <text
          x={x(depot.lon)}
          y={y(depot.lat) - 20}
          textAnchor="middle"
          fontSize="8"
          fill="#3ED598"
          fontFamily="'JetBrains Mono', monospace"
          fontWeight="600"
        >
          DEPOT
        </text>
        {/* Connecting line */}
        <line
          x1={x(depot.lon)}
          y1={y(depot.lat) - 14}
          x2={x(depot.lon)}
          y2={y(depot.lat) - 10}
          stroke="#3ED598"
          strokeWidth="1"
          opacity="0.6"
        />
        {/* Depot circle */}
        <circle
          cx={x(depot.lon)}
          cy={y(depot.lat)}
          r="8"
          fill="#0B1220"
          stroke="#3ED598"
          strokeWidth="2"
        />
      </g>

      {jitteredAtms.filter(a => !selectedZoneType || a.zone_type === selectedZoneType).map(atm => {
        const p = priMap[atm.atm_id];
        if (!p) return null;
        const color = RISK_COLOR(p.risk_score);
        const isSel = selectedAtm === atm.atm_id;
        const r = isSel ? 8 : 5;
        return (
          <g key={atm.atm_id} onClick={() => onSelectAtm(atm.atm_id)} style={{ cursor: "pointer" }}>
            {p.risk_score >= 55 && (
              <circle cx={x(atm.lon)} cy={y(atm.lat)} r={r + 4} fill={color} opacity="0.18">
                <animate attributeName="r" values={`${r};${r + 10};${r}`} dur={p.risk_score >= 75 ? "1.2s" : "2.4s"} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.25;0;0.25" dur={p.risk_score >= 75 ? "1.2s" : "2.4s"} repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={x(atm.lon)} cy={y(atm.lat)} r={r} fill={color} stroke={isSel ? "#E8ECF4" : "#0B1220"} strokeWidth={isSel ? 2 : 1} />
          </g>
        );
      })}
    </svg>
  );
}

function ForecastChart({ forecast, atmId }) {
  const data = forecast.map(f => ({
    date: f.date.slice(5),
    amount: f.predicted_withdrawal,
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1C2740" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: "#5E6980", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: "#232E45" }} tickLine={false} />
        <YAxis tick={{ fill: "#5E6980", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false}
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={40} />
        <Tooltip
          contentStyle={{ background: "#131C2E", border: "1px solid #232E45", borderRadius: 8, fontSize: 12, fontFamily: "Inter" }}
          labelStyle={{ color: "#8B96AC" }}
          formatter={(v) => [`₹${v.toLocaleString("en-IN")}`, "Predicted withdrawal"]}
        />
        <Line type="monotone" dataKey="amount" stroke="#3ED598" strokeWidth={2} dot={{ r: 3, fill: "#3ED598" }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function CompareChart({ a, b }) {
  const data = a.forecast.map((f, i) => ({
    date: f.date.slice(5),
    [a.id]: f.predicted_withdrawal,
    [b.id]: b.forecast[i] ? b.forecast[i].predicted_withdrawal : null,
  }));
  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 11.5 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 3, background: a.color, display: "inline-block", borderRadius: 2 }} />
          <span style={{ color: "#8B96AC", fontFamily: "'JetBrains Mono', monospace" }}>{a.id}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 3, background: b.color, display: "inline-block", borderRadius: 2 }} />
          <span style={{ color: "#8B96AC", fontFamily: "'JetBrains Mono', monospace" }}>{b.id}</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1C2740" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#5E6980", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: "#232E45" }} tickLine={false} />
          <YAxis tick={{ fill: "#5E6980", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={40} />
          <Tooltip
            contentStyle={{ background: "#131C2E", border: "1px solid #232E45", borderRadius: 8, fontSize: 12, fontFamily: "Inter" }}
            labelStyle={{ color: "#8B96AC" }}
            formatter={(v, name) => [`₹${v?.toLocaleString("en-IN")}`, name]}
          />
          <Line type="monotone" dataKey={a.id} stroke={a.color} strokeWidth={2} dot={{ r: 3, fill: a.color }} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey={b.id} stroke={b.color} strokeWidth={2} dot={{ r: 3, fill: b.color }} activeDot={{ r: 5 }} strokeDasharray="5 3" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function FeatureImportanceChart({ importance }) {
  const data = Object.entries(importance).map(([k, v]) => ({
    name: k.replace("zt_", "").replace("_", " "),
    value: v * 100,
  })).sort((a, b) => b.value - a.value);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
        <XAxis type="number" tick={{ fill: "#5E6980", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: "#232E45" }} tickLine={false} unit="%" />
        <YAxis type="category" dataKey="name" tick={{ fill: "#8B96AC", fontSize: 11, fontFamily: "Inter" }} axisLine={false} tickLine={false} width={110} />
        <Tooltip contentStyle={{ background: "#131C2E", border: "1px solid #232E45", borderRadius: 8, fontSize: 12 }}
          formatter={(v) => [`${v.toFixed(1)}%`, "Importance"]} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => <Cell key={i} fill={i === 0 ? "#3ED598" : "#2A3654"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ============================================================
// PREDICTION ENGINE v3 — multi-model ensemble
// ============================================================
// Four independent estimators run on the same 7-day forecast series.
// Each produces its own next-day number; they're then combined with
// weights that shift based on how volatile the series is (a stable
// ATM leans on trend + EWMA, a choppy one leans on the robust median
// model instead, since trend lines overreact to noisy data).
//
//   1. Linear trend regression  — captures directional momentum
//   2. EWMA (alpha=0.5)         — reacts fastest to the last 1-2 days
//   3. Weighted recency average — average of last 3 days, recency-weighted
//   4. Robust median model      — median of the series, ignores spikes
//
// A zone-type seasonality multiplier is applied after the blend, and a
// cash-adjusted "what-if" mode lets the user override current cash to
// re-run the days-to-empty projection without touching the real data.

function linearTrendModel(vals) {
  const n = vals.length;
  const xs = vals.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = vals.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - meanX) * (vals[i] - meanY), 0);
  const den = xs.reduce((s, x) => s + (x - meanX) ** 2, 0) || 1;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  return { value: intercept + slope * n, slope, meanY };
}

function ewmaModel(vals, alpha = 0.5) {
  let ewma = vals[0];
  for (let i = 1; i < vals.length; i++) ewma = alpha * vals[i] + (1 - alpha) * ewma;
  return ewma;
}

function recencyWeightedModel(vals) {
  const tail = vals.slice(-3);
  const weights = tail.map((_, i) => i + 1); // e.g. [1,2,3] -> most recent weighted highest
  const wsum = weights.reduce((a, b) => a + b, 0);
  return tail.reduce((s, v, i) => s + v * weights[i], 0) / wsum;
}

function robustMedianModel(vals) {
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function runPrediction(forecast, priorityRow, atmInfo, anomalies, cashOverride) {
  if (!forecast || forecast.length === 0 || !priorityRow) return null;

  const vals = forecast.map(f => f.predicted_withdrawal);
  const n = vals.length;
  const meanY = vals.reduce((a, b) => a + b, 0) / n;

  const variance = vals.reduce((s, v) => s + (v - meanY) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const cv = meanY > 0 ? std / meanY : 0; // coefficient of variation — volatility measure

  // Run all four models
  const trend = linearTrendModel(vals);
  const ewma = ewmaModel(vals);
  const recency = recencyWeightedModel(vals);
  const median = robustMedianModel(vals);

  // Adaptive weighting: choppy series (high cv) trust the robust models more;
  // calm series lean on trend + EWMA which react faster and more precisely.
  const choppy = Math.min(1, cv * 2.2); // 0 = calm, 1 = very choppy
  const weights = {
    trend: 0.35 * (1 - choppy) + 0.10 * choppy,
    ewma: 0.30 * (1 - choppy) + 0.15 * choppy,
    recency: 0.20 * (1 - choppy) + 0.25 * choppy,
    median: 0.15 * (1 - choppy) + 0.50 * choppy,
  };

  const rawBlend =
    trend.value * weights.trend +
    ewma * weights.ewma +
    recency * weights.recency +
    median * weights.median;

  // Zone-type seasonality multiplier
  const zoneType = atmInfo ? atmInfo.zone_type : "";
  const seasonalityMultiplier = {
    commercial: 1.04, tourist: 1.06, transit: 1.03, industrial: 0.98, residential: 1.0,
  }[zoneType] || 1.0;

  const predictedNext = Math.max(0, rawBlend * seasonalityMultiplier);

  // Model agreement: how tightly the four estimates cluster (as % of mean).
  // Tight cluster = models agree = higher confidence.
  const estimates = [trend.value, ewma, recency, median];
  const estMean = estimates.reduce((a, b) => a + b, 0) / 4;
  const estSpread = Math.sqrt(estimates.reduce((s, v) => s + (v - estMean) ** 2, 0) / 4);
  const agreement = meanY > 0 ? Math.max(0, 1 - estSpread / meanY) : 0.5;

  const baseConfidence = 100 - cv * 85;
  const confidence = Math.max(50, Math.min(98, Math.round(baseConfidence * 0.55 + agreement * 100 * 0.45)));

  const atmAnomalies = (anomalies || []).filter(a => a.atm_id === priorityRow.atm_id);
  const anomalyRisk = atmAnomalies.length > 0;
  const bandWidth = std * (anomalyRisk ? 1.4 : 1.0) * (1 + choppy * 0.3);
  const lower = Math.max(0, predictedNext - bandWidth);
  const upper = predictedNext + bandWidth;

  // 3-day rolling outlook — each step blends the prior predicted value with a
  // decaying trend component so the projection tapers rather than running away
  const outlook = [];
  let cursor = predictedNext;
  for (let d = 1; d <= 3; d++) {
    const decayedTrend = trend.slope * (0.65 ** d);
    cursor = Math.max(0, cursor * 0.7 + (ewma + decayedTrend * n) * 0.3);
    outlook.push(Math.round(cursor));
  }

  // Days-to-empty, using cash override if the user supplied a what-if value
  const currentCash = cashOverride != null && cashOverride !== "" ? Number(cashOverride) : priorityRow.current_cash;
  let remaining = currentCash;
  let daysToEmptyPredicted = null;
  const burnSeries = [predictedNext, ...outlook];
  for (let i = 0; i < burnSeries.length; i++) {
    remaining -= burnSeries[i];
    if (remaining <= 0 && daysToEmptyPredicted === null) {
      const frac = burnSeries[i] > 0 ? 1 - Math.abs(remaining) / burnSeries[i] : 0;
      daysToEmptyPredicted = +(i + frac).toFixed(1);
    }
  }
  if (daysToEmptyPredicted === null) {
    const dailyBurn = predictedNext > 0 ? predictedNext : meanY;
    daysToEmptyPredicted = dailyBurn > 0 ? +(currentCash / dailyBurn).toFixed(1) : 99;
  }

  const trendLabel = trend.slope > meanY * 0.03 ? "rising" : trend.slope < -meanY * 0.03 ? "falling" : "stable";

  let action, actionColor;
  if (daysToEmptyPredicted < 1) { action = "Refill within 24h"; actionColor = "#EF4B5F"; }
  else if (daysToEmptyPredicted < 2) { action = "Schedule refill soon"; actionColor = "#F5A623"; }
  else if (daysToEmptyPredicted < 4) { action = "Monitor closely"; actionColor = "#F5D923"; }
  else { action = "No action needed"; actionColor = "#3ED598"; }

  return {
    predictedNext: Math.round(predictedNext),
    lower: Math.round(lower),
    upper: Math.round(upper),
    confidence,
    trend: trendLabel,
    daysToEmptyPredicted,
    action,
    actionColor,
    outlook,
    anomalyRisk,
    choppy,
    models: {
      trend: Math.round(trend.value),
      ewma: Math.round(ewma),
      recency: Math.round(recency),
      median: Math.round(median),
    },
    weights,
  };
}

// Small horizontal bar used in the model-breakdown list
function ModelBar({ label, value, weight, maxVal, color }) {
  const pct = maxVal > 0 ? Math.min(100, (value / maxVal) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
      <div style={{ width: 74, fontSize: 10.5, color: "#8B96AC", fontFamily: "'JetBrains Mono', monospace" }}>{label}</div>
      <div style={{ flex: 1, height: 6, background: "#0B1220", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.5s ease" }} />
      </div>
      <div style={{ width: 62, fontSize: 10.5, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#C9D2E3" }}>
        ₹{(value / 1000).toFixed(0)}k
      </div>
      <div style={{ width: 34, fontSize: 9.5, textAlign: "right", color: "#5E6980" }}>{Math.round(weight * 100)}%</div>
    </div>
  );
}

// Circular confidence gauge, animates in on new results
function ConfidenceGauge({ value }) {
  const r = 30, C = 2 * Math.PI * r;
  const [dash, setDash] = useState(C);
  React.useEffect(() => {
    const t = setTimeout(() => setDash(C - (value / 100) * C), 50);
    return () => clearTimeout(t);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = value >= 80 ? "#3ED598" : value >= 60 ? "#F5A623" : "#EF4B5F";
  return (
    <svg width="76" height="76" viewBox="0 0 76 76">
      <circle cx="38" cy="38" r={r} fill="none" stroke="#0B1220" strokeWidth="7" />
      <circle
        cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={dash} transform="rotate(-90 38 38)"
        style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }}
      />
      <text x="38" y="34" textAnchor="middle" fontSize="16" fontWeight="600" fill="#E8ECF4" fontFamily="'Space Grotesk', sans-serif">{value}</text>
      <text x="38" y="48" textAnchor="middle" fontSize="8" fill="#5E6980" fontFamily="'JetBrains Mono', monospace">CONF %</text>
    </svg>
  );
}

// Standalone prediction module — has its OWN ATM picker, independent of
// whatever is selected elsewhere in the app, so you can predict for any
// ATM without navigating the map or table first.
function PredictPanel({ atms, forecasts, priority, anomalies, defaultAtm }) {
  const [pickedAtm, setPickedAtm] = useState(defaultAtm);
  const [zoneFilter, setZoneFilter] = useState("");
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [whatIf, setWhatIf] = useState("");
  const [history, setHistory] = useState([]); // last few predictions run this session

  const priMap = useMemo(() => Object.fromEntries(priority.map(p => [p.atm_id, p])), [priority]);
  const atmInfo = atms.find(a => a.atm_id === pickedAtm);
  const priorityRow = priMap[pickedAtm];
  const forecast = forecasts[pickedAtm] || [];

  const zoneTypes = [...new Set(atms.map(a => a.zone_type))];
  const filteredAtms = zoneFilter ? atms.filter(a => a.zone_type === zoneFilter) : atms;

  React.useEffect(() => { setResult(null); setWhatIf(""); }, [pickedAtm]);

  const handlePredict = () => {
    setRunning(true);
    setResult(null);
    setTimeout(() => {
      const r = runPrediction(forecast, priorityRow, atmInfo, anomalies, whatIf);
      setResult(r);
      setRunning(false);
      if (r) {
        setHistory(h => [{ atmId: pickedAtm, predictedNext: r.predictedNext, confidence: r.confidence, action: r.action, actionColor: r.actionColor, ts: Date.now() }, ...h].slice(0, 5));
      }
    }, 500);
  };

  if (!priorityRow) return null;
  const maxModelVal = result ? Math.max(...Object.values(result.models)) : 1;

  return (
    <div style={{
      background: "linear-gradient(160deg, #131C2E 0%, #101827 100%)", border: "1px solid #232E45",
      borderRadius: 12, padding: 18, marginTop: 14
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
            🔮 Predict cash demand
          </div>
          <div style={{ fontSize: 11, color: "#5E6980", marginTop: 2 }}>4-model ensemble · pick any ATM, independent of the page selection</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)} style={{
            background: "#0B1220", color: "#8B96AC", border: "1px solid #232E45", borderRadius: 6, padding: "6px 8px", fontSize: 11.5
          }}>
            <option value="">All zone types</option>
            {zoneTypes.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
          <select value={pickedAtm} onChange={e => setPickedAtm(e.target.value)} style={{
            background: "#0B1220", color: "#E8ECF4", border: "1px solid #3ED59855", borderRadius: 6, padding: "6px 10px", fontSize: 12.5, fontFamily: "'JetBrains Mono', monospace", minWidth: 170
          }}>
            {filteredAtms.map(a => <option key={a.atm_id} value={a.atm_id}>{a.atm_id} · {a.zone}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 11.5, color: "#8B96AC" }}>
          <span style={{ color: "#E8ECF4", fontWeight: 600 }}>{atmInfo?.zone}</span> · {atmInfo?.bank_branch} · {atmInfo?.zone_type} · current cash ₹{priorityRow.current_cash.toLocaleString("en-IN")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <span style={{ fontSize: 11, color: "#5E6980" }}>What-if cash override:</span>
          <input
            type="number" value={whatIf} onChange={e => setWhatIf(e.target.value)}
            placeholder={priorityRow.current_cash.toString()}
            style={{
              background: "#0B1220", color: "#E8ECF4", border: "1px solid #232E45", borderRadius: 6,
              padding: "5px 8px", fontSize: 11.5, width: 110, fontFamily: "'JetBrains Mono', monospace"
            }}
          />
        </div>
        <button
          className="aopt-btn"
          onClick={handlePredict}
          disabled={running}
          style={{
            background: running ? "#0F1826" : "#132A22", color: "#3ED598", border: "1px solid #3ED59855",
            borderRadius: 7, padding: "8px 18px", fontSize: 12.5, fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600, cursor: running ? "default" : "pointer", display: "flex", alignItems: "center", gap: 8
          }}
        >
          {running ? (
            <>
              <span style={{
                width: 12, height: 12, border: "2px solid #3ED59855", borderTopColor: "#3ED598",
                borderRadius: "50%", display: "inline-block", animation: "aopt-spin 0.7s linear infinite"
              }} />
              Predicting…
            </>
          ) : (
            <>▶ Run prediction</>
          )}
        </button>
      </div>

      {result && (
        <div className="aopt-panel">
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div style={{ background: "#0B1220", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <ConfidenceGauge value={result.confidence} />
              <div style={{ fontSize: 10, color: "#5E6980", marginTop: 6, textTransform: "capitalize" }}>{result.choppy > 0.5 ? "choppy series" : "stable series"}</div>
            </div>

            <div style={{ background: "#0B1220", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 10.5, color: "#8B96AC", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Ensemble prediction</div>
              <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>₹{result.predictedNext.toLocaleString("en-IN")}</div>
              <div style={{ fontSize: 10.5, color: "#5E6980", marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                range ₹{result.lower.toLocaleString("en-IN")} – ₹{result.upper.toLocaleString("en-IN")} · trend {result.trend}
              </div>
              <div style={{ marginTop: 10 }}>
                <ModelBar label="Trend" value={result.models.trend} weight={result.weights.trend} maxVal={maxModelVal} color="#5DB4F0" />
                <ModelBar label="EWMA" value={result.models.ewma} weight={result.weights.ewma} maxVal={maxModelVal} color="#3ED598" />
                <ModelBar label="Recency" value={result.models.recency} weight={result.weights.recency} maxVal={maxModelVal} color="#F5A623" />
                <ModelBar label="Median" value={result.models.median} weight={result.weights.median} maxVal={maxModelVal} color="#C77DFF" />
              </div>
            </div>

            <div style={{ background: "#0B1220", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 10.5, color: "#8B96AC", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Recommended action</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: result.actionColor, marginBottom: 6 }}>{result.action}</div>
              <div style={{ fontSize: 11, color: "#5E6980", fontFamily: "'JetBrains Mono', monospace", marginBottom: 12 }}>
                ~{result.daysToEmptyPredicted}d to empty{whatIf ? " (what-if)" : ""}
              </div>
              <div style={{ fontSize: 10.5, color: "#8B96AC", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>3-day outlook</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {result.outlook.map((v, i) => (
                  <span key={i} style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", background: "#131C2E", padding: "3px 8px", borderRadius: 5, color: "#C9D2E3" }}>
                    D+{i + 1}: ₹{(v / 1000).toFixed(0)}k
                  </span>
                ))}
              </div>
              {result.anomalyRisk && (
                <div style={{ marginTop: 10, fontSize: 10.5, color: "#C77DFF", background: "#1E1730", border: "1px solid #C77DFF44", padding: "5px 10px", borderRadius: 8 }}>
                  ⚠ Anomaly history on this ATM — band widened
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ borderTop: "1px solid #1C2740", paddingTop: 12, marginTop: result ? 4 : 0 }}>
          <div style={{ fontSize: 10.5, color: "#5E6980", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Session history</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {history.map((h, i) => (
              <div key={h.ts} style={{
                fontSize: 10.5, background: "#0B1220", border: "1px solid #1C2740", borderRadius: 7,
                padding: "5px 10px", display: "flex", alignItems: "center", gap: 6, opacity: 1 - i * 0.12
              }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#8B96AC" }}>{h.atmId}</span>
                <span style={{ color: "#E8ECF4" }}>₹{(h.predictedNext / 1000).toFixed(0)}k</span>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: h.actionColor, display: "inline-block" }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


const TABS = ["Network overview", "Demand forecasting", "Refill priority", "Route planning", "Anomaly detection"];

const SORT_OPTIONS = [
  { key: "risk_score", label: "Risk score", dir: -1 },
  { key: "days_to_empty", label: "Days to empty", dir: 1 },
  { key: "current_cash", label: "Current cash", dir: 1 },
  { key: "recommended_fill_amount", label: "Fill amount", dir: -1 },
];

function toCSV(rows) {
  const headers = ["atm_id", "zone", "zone_type", "risk_score", "current_cash", "days_to_empty", "recommended_fill_amount", "needs_refill"];
  const lines = [headers.join(",")];
  rows.forEach(r => {
    lines.push(headers.map(h => r[h]).join(","));
  });
  return lines.join("\n");
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ZoneSummary({ priority }) {
  const byZoneType = useMemo(() => {
    const groups = {};
    priority.forEach(p => {
      if (!groups[p.zone_type]) groups[p.zone_type] = { count: 0, riskSum: 0, refill: 0, cash: 0, capacity: 0 };
      const g = groups[p.zone_type];
      g.count += 1;
      g.riskSum += p.risk_score;
      g.refill += p.needs_refill ? 1 : 0;
      g.cash += p.current_cash;
      g.capacity += p.capacity;
    });
    return Object.entries(groups).map(([zt, g]) => ({
      zone_type: zt,
      avgRisk: g.riskSum / g.count,
      count: g.count,
      refill: g.refill,
    })).sort((a, b) => b.avgRisk - a.avgRisk);
  }, [priority]);

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
      {byZoneType.map(z => (
        <div key={z.zone_type} className="aopt-zonecard" style={{
          flex: "1 1 140px", background: "linear-gradient(160deg, #131C2E 0%, #101827 100%)",
          border: "1px solid #232E45", borderRadius: 10, padding: "12px 14px", position: "relative", overflow: "hidden"
        }}>
          <div style={{ position: "absolute", top: 0, right: 0, width: 3, height: "100%", background: RISK_COLOR(z.avgRisk) }} />
          <div style={{ fontSize: 11, color: "#8B96AC", textTransform: "capitalize", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>{z.zone_type}</div>
          <div style={{ fontSize: 18, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", color: RISK_COLOR(z.avgRisk) }}>{z.avgRisk.toFixed(0)}</div>
          <div style={{ fontSize: 10.5, color: "#5E6980" }}>{z.count} ATMs · {z.refill} need refill</div>
        </div>
      ))}
    </div>
  );
}

export default function ATMOptimizer() {
  const [tab, setTab] = useState(0);
  const [selectedAtm, setSelectedAtm] = useState(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [zoneFilter, setZoneFilter] = useState("");
  const [showRoutes, setShowRoutes] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("risk_score");
  const [compareAtm, setCompareAtm] = useState(null);
  const [highlightVan, setHighlightVan] = useState(null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

 useEffect(() => {
    setTabLoading(true);
    Promise.all([
        fetchATMs(),
        fetchForecasts(),
        fetchPriority(),
        fetchAnomalies(),
        fetchRoutes(),
        fetchMetrics()
    ]).then(([atms, forecasts, priority, anomalies, routes, metrics]) => {
        setData({ atms, forecasts, priority, anomalies, routes, metrics });
        setLoading(false);
        setTabLoading(false);
    }).catch(err => {
        console.error("Failed to load data:", err);
        setLoading(false);
        setTabLoading(false);
    });
}, []);



  // All other hooks must go HERE, before any if statements
  const priMap = useMemo(() => {
    if (!data) return {};
    return Object.fromEntries(data.priority.map(p => [p.atm_id, p]));
  }, [data]);

  const sortedPriority = useMemo(() => {
    if (!data) return [];
    const opt = SORT_OPTIONS.find(o => o.key === sortKey) || SORT_OPTIONS[0];
    return [...data.priority].sort((a, b) => (a[opt.key] - b[opt.key]) * opt.dir);
  }, [data, sortKey]);

  const searchResults = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return data.priority.filter(p => p.atm_id.toLowerCase().includes(q) || p.zone.toLowerCase().includes(q));
  }, [data, search]);

  React.useEffect(() => {
    if (searchResults.length > 0) {
      setSelectedAtm(searchResults[0].atm_id);
    }
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchedPriority = search.trim() ? searchResults.slice().sort((a, b) => {
    const opt = SORT_OPTIONS.find(o => o.key === sortKey) || SORT_OPTIONS[0];
    return (a[opt.key] - b[opt.key]) * opt.dir;
  }) : sortedPriority;
  // NOW the early returns
  if (loading) return (
    <div style={{ background: "#0B1220", color: "#3ED598", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk', sans-serif", fontSize: 18 }}>
      <span style={{ marginRight: 12, width: 16, height: 16, border: "2px solid #3ED59855", borderTopColor: "#3ED598", borderRadius: "50%", display: "inline-block", animation: "spin 1s linear infinite" }}></span>
      Loading ATM network data...
    </div>
  );

  if (!data) return (
    <div style={{ background: "#0B1220", color: "#EF4B5F", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk', sans-serif", fontSize: 18 }}>
      Error loading data. Is backend running on port 5000?
    </div>
  );

  const { atms, forecasts, anomalies, priority, routes, metrics } = data;
  const critical = priority.filter(p => p.risk_score >= 75).length;
  const needsRefill = priority.filter(p => p.needs_refill).length;
  const healthy = priority.filter(p => p.risk_score < 35).length;
  const totalCash = priority.reduce((s, p) => s + p.current_cash, 0);
  const totalCapacity = priority.reduce((s, p) => s + p.capacity, 0); // eslint-disable-line react-hooks/exhaustive-deps

  const zoneTypes = [...new Set(atms.map(a => a.zone_type))];

  const activeAtm = selectedAtm || (sortedPriority[0] ? sortedPriority[0].atm_id : priority[0].atm_id);
  const activeForecast = forecasts[activeAtm] || [];
  const activePriority = priMap[activeAtm];
  const activeAtmInfo = atms.find(a => a.atm_id === activeAtm);

  return (
    <div className="aopt-shell" style={{
      fontFamily: "'Inter', sans-serif", background: "#0B1220", color: "#E8ECF4",
      padding: "28px 24px", minHeight: "100vh", width: "100%", boxSizing: "border-box"
    }}>
      <style>{`
        @keyframes pulse { 0%,100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.3); opacity: 0.4; } }
       @keyframes aopt-spin { to { transform: rotate(360deg); } }
               @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes aopt-fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        .aopt-tab { transition: all 0.15s ease; position: relative; }
        .aopt-tab:hover { color: #E8ECF4 !important; }
        .aopt-row { transition: background 0.12s ease; }
        .aopt-row:hover { background: #16203380 !important; }
        .aopt-stat { transition: transform 0.15s ease, border-color 0.15s ease; }
        .aopt-stat:hover { transform: translateY(-2px); border-color: #2C3B5C !important; }
        .aopt-zonecard { transition: transform 0.15s ease, border-color 0.15s ease; }
        .aopt-zonecard:hover { transform: translateY(-2px); border-color: #2C3B5C !important; }
        .aopt-btn { transition: all 0.15s ease; cursor: pointer; }
        .aopt-btn:hover { background: #1C2740 !important; border-color: #3ED598 !important; color: #3ED598 !important; }
        .aopt-panel { animation: aopt-fadein 0.25s ease; }
        .aopt-search:focus { outline: none; border-color: #3ED598 !important; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: #232E45; border-radius: 3px; }
      `}</style>

      <div className="aopt-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 11, color: "#3ED598", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", marginBottom: 4 }}>
            CASH LOGISTICS · JAIPUR NETWORK
          </div>
          <div style={{ fontSize: 24, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 10 }}>
            ATM Cash Refill Optimizer
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 500, background: "#132A22", color: "#3ED598", padding: "3px 9px", borderRadius: 20, fontFamily: "'JetBrains Mono', monospace" }}>
              <Pulse score={20} /> LIVE
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <input
            className="aopt-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search ATM ID or zone…"
            style={{
              background: "#131C2E", color: "#E8ECF4", border: "1px solid #232E45", borderRadius: 8,
              padding: "6px 12px", fontSize: 12, width: 200, fontFamily: "'JetBrains Mono', monospace"
            }}
          />
          <div style={{ textAlign: "right", fontSize: 11, color: "#5E6980", fontFamily: "'JetBrains Mono', monospace" }}>
            Model R² {metrics.r2} · MAPE {metrics.mape}%<br />
            {metrics.n_atms} ATMs · {metrics.training_samples.toLocaleString()} training samples
          </div>
        </div>
      </div>

      <div className="aopt-stats" style={{ display: "flex", gap: 12, marginBottom: 22, flexWrap: "wrap" }}>
        <StatCard label="Network cash" value={<>₹<CountUp value={totalCash / 10000000} format={v => v.toFixed(2)} />Cr</>} sub={`of ₹${(totalCapacity / 10000000).toFixed(2)}Cr capacity`} />
        <StatCard label="Critical ATMs" value={<CountUp value={critical} />} sub="risk score ≥ 75" accent={critical > 0 ? "#EF4B5F" : "#3ED598"} />
        <StatCard label="Need refill" value={<CountUp value={needsRefill} />} sub={`of ${atms.length} total`} accent="#F5A623" />
        <StatCard label="Healthy" value={<CountUp value={healthy} />} sub="risk score < 35" accent="#3ED598" />
        <StatCard label="Vans required" value={<CountUp value={routes.total_vans_needed} />} sub={`${routes.total_distance_km} km total`} />
        <StatCard label="Anomalies flagged" value={<CountUp value={anomalies.length} />} sub="last 90 days" accent="#C77DFF" />
      </div>

      <AlertBanner priority={priority} onSelectAtm={setSelectedAtm} onGoToTab={setTab} />

      <div className="aopt-tabs" role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid #1C2740", marginBottom: 20 }}>
        {TABS.map((t, i) => (
         <div key={t} role="tab" aria-selected={tab === i} className="aopt-tab" onClick={() => {
    setTab(i);
    setTabLoading(true);
    Promise.all([
      fetchATMs(),
      fetchForecasts(),
      fetchPriority(),
      fetchAnomalies(),
      fetchRoutes(),
      fetchMetrics()
    ]).then(([atms, forecasts, priority, anomalies, routes, metrics]) => {
      setTimeout(() => {
        setData({ atms, forecasts, priority, anomalies, routes, metrics });
        setTabLoading(false);
      }, 600); // always show for 600ms
    }).catch(() => setTabLoading(false));
  }} style={{
            padding: "10px 16px", cursor: "pointer", fontSize: 13, fontWeight: 500,
            color: tab === i ? "#3ED598" : "#8B96AC",
            borderBottom: tab === i ? "2px solid #3ED598" : "2px solid transparent",
            fontFamily: "'Space Grotesk', sans-serif"
          }}>{t}</div>
        ))}
      </div>
        {tabLoading ? (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 400,
          color: "#3ED598",
          fontSize: 16,
          fontFamily: "'Space Grotesk', sans-serif",
          gap: 12
        }}>
          <span style={{
            width: 20, height: 20,
            border: "3px solid #3ED59833",
            borderTopColor: "#3ED598",
            borderRadius: "50%",
            display: "inline-block",
            animation: "spin 0.8s linear infinite"
          }} />
          Loading tab data...
        </div>
      ) : (
        <>


      {tab === 0 && (
        <div className="aopt-panel" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "#8B96AC" }}>Filter zone:</span>
              <select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)} style={{
                background: "#131C2E", color: "#E8ECF4", border: "1px solid #232E45", borderRadius: 6, padding: "4px 8px", fontSize: 12
              }}>
                <option value="">All zones</option>
                {zoneTypes.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
              <label style={{ fontSize: 12, color: "#8B96AC", display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                <input type="checkbox" checked={showRoutes} onChange={e => setShowRoutes(e.target.checked)} />
                Show van routes
              </label>
            </div>
            <NetworkMap atms={atms} priority={priority} selectedZoneType={zoneFilter}
              onSelectAtm={setSelectedAtm} selectedAtm={activeAtm} routes={routes} showRoutes={showRoutes} />
            <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11, color: "#8B96AC", flexWrap: "wrap" }}>
              {[["Critical", "#EF4B5F"], ["Refill now", "#F5A623"], ["Monitor", "#F5D923"], ["Healthy", "#3ED598"]].map(([l, c]) => (
                <span key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }} />{l}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#8B96AC", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Selected ATM · {activeAtm}
            </div>
            <div style={{ background: "#131C2E", border: "1px solid #232E45", borderRadius: 10, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>{activeAtmInfo.zone}</div>
              <div style={{ fontSize: 12, color: "#5E6980", marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                {activeAtmInfo.bank_branch} · {activeAtmInfo.zone_type}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: "#8B96AC" }}>Current cash</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>₹{activePriority.current_cash.toLocaleString("en-IN")}</span>
              </div>
              <div style={{ height: 6, background: "#0B1220", borderRadius: 3, marginBottom: 12, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${activePriority.capacity_ratio * 100}%`, background: RISK_COLOR(activePriority.risk_score), borderRadius: 3 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: "#8B96AC" }}>Days to empty</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: activePriority.days_to_empty < 2 ? "#EF4B5F" : "#E8ECF4" }}>{activePriority.days_to_empty}d</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: "#8B96AC" }}>Risk score</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: RISK_COLOR(activePriority.risk_score) }}>{activePriority.risk_score} · {RISK_LABEL(activePriority.risk_score)}</span>
              </div>
              
            </div>
            <div style={{ fontSize: 12, color: "#8B96AC", marginBottom: 8 }}>7-day demand forecast</div>
            <ForecastChart forecast={activeForecast} atmId={activeAtm} />
            <PredictPanel atms={atms} forecasts={forecasts} priority={priority} anomalies={anomalies} defaultAtm={activeAtm} />
          </div>
        </div>
      )}

      {tab === 1 && (
        <div className="aopt-panel">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
            <div style={{ background: "#131C2E", border: "1px solid #232E45", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 12, color: "#8B96AC", marginBottom: 10 }}>Model performance (14-day holdout)</div>
              <div style={{ display: "flex", gap: 20 }}>
                <div><div style={{ fontSize: 20, fontWeight: 600, fontFamily: "'Space Grotesk'" }}>{metrics.r2}</div><div style={{ fontSize: 11, color: "#5E6980" }}>R² score</div></div>
                <div><div style={{ fontSize: 20, fontWeight: 600, fontFamily: "'Space Grotesk'" }}>{metrics.mape}%</div><div style={{ fontSize: 11, color: "#5E6980" }}>MAPE</div></div>
                <div><div style={{ fontSize: 20, fontWeight: 600, fontFamily: "'Space Grotesk'" }}>₹{metrics.mae.toLocaleString("en-IN")}</div><div style={{ fontSize: 11, color: "#5E6980" }}>MAE</div></div>
              </div>
              <div style={{ fontSize: 11, color: "#5E6980", marginTop: 10, lineHeight: 1.5 }}>
                XGBoost regression, trained on {metrics.training_samples.toLocaleString()} ATM-day records. Features: lag values, rolling stats, salary-cycle flags, zone type.
              </div>
            </div>
            <div style={{ background: "#131C2E", border: "1px solid #232E45", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 12, color: "#8B96AC", marginBottom: 10 }}>Feature importance</div>
              <FeatureImportanceChart importance={metrics.feature_importance} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#8B96AC", marginBottom: 10 }}>Select an ATM to inspect its forecast</div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <select value={activeAtm} onChange={e => setSelectedAtm(e.target.value)} style={{
              background: "#131C2E", color: "#E8ECF4", border: "1px solid #232E45", borderRadius: 6, padding: "6px 10px", fontSize: 13
            }}>
              {atms.map(a => <option key={a.atm_id} value={a.atm_id}>{a.atm_id} · {a.zone}</option>)}
            </select>
            <span style={{ fontSize: 12, color: "#5E6980" }}>vs</span>
            <select value={compareAtm || ""} onChange={e => setCompareAtm(e.target.value || null)} style={{
              background: "#131C2E", color: compareAtm ? "#E8ECF4" : "#5E6980", border: "1px solid #232E45", borderRadius: 6, padding: "6px 10px", fontSize: 13
            }}>
              <option value="">Compare with…</option>
              {atms.filter(a => a.atm_id !== activeAtm).map(a => <option key={a.atm_id} value={a.atm_id}>{a.atm_id} · {a.zone}</option>)}
            </select>
            {compareAtm && (
              <button className="aopt-btn" onClick={() => setCompareAtm(null)} style={{
                background: "#131C2E", color: "#8B96AC", border: "1px solid #232E45", borderRadius: 6, padding: "5px 10px", fontSize: 11.5
              }}>Clear comparison</button>
            )}
          </div>
          {compareAtm ? (
            <CompareChart
              a={{ id: activeAtm, forecast: activeForecast, color: "#3ED598" }}
              b={{ id: compareAtm, forecast: forecasts[compareAtm] || [], color: "#5DB4F0" }}
            />
          ) : (
            <ForecastChart forecast={activeForecast} atmId={activeAtm} />
          )}
          <PredictPanel atms={atms} forecasts={forecasts} priority={priority} anomalies={anomalies} defaultAtm={activeAtm} />
        </div>
      )}

      {tab === 2 && (
        <div className="aopt-panel">
          <ZoneSummary priority={priority} />
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "#8B96AC" }}>Sort by:</span>
            <select value={sortKey} onChange={e => setSortKey(e.target.value)} style={{
              background: "#131C2E", color: "#E8ECF4", border: "1px solid #232E45", borderRadius: 6, padding: "4px 8px", fontSize: 12
            }}>
              {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            {search && (
              <span style={{ fontSize: 12, color: "#3ED598", fontFamily: "'JetBrains Mono', monospace" }}>
                {searchedPriority.length} match{searchedPriority.length !== 1 ? "es" : ""} for "{search}"
              </span>
            )}
            <button
              className="aopt-btn"
              onClick={() => downloadCSV(toCSV(searchedPriority), "atm_refill_priority.csv")}
              style={{
                marginLeft: "auto", background: "#131C2E", color: "#8B96AC", border: "1px solid #232E45",
                borderRadius: 6, padding: "5px 12px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace"
              }}
            >
              ↓ Export CSV
            </button>
          </div>
          <div style={{ maxHeight: 460, overflowY: "auto", border: "1px solid #232E45", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: "#131C2E", zIndex: 1 }}>
                  {["ATM", "Zone", "Risk", "Current cash", "Days to empty", "Recommended fill", "7d trend"].map(h => (
                    <th key={h} style={{ textAlign: h === "ATM" || h === "Zone" ? "left" : "right", padding: "10px 14px", color: "#8B96AC", fontWeight: 500, borderBottom: "1px solid #232E45" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {searchedPriority.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#5E6980", fontSize: 12.5 }}>No ATMs match "{search}"</td></tr>
                )}
                {searchedPriority.map(p => (
                  <tr key={p.atm_id} className="aopt-row" onClick={() => { setSelectedAtm(p.atm_id); setTab(0); }} style={{ cursor: "pointer", borderBottom: "1px solid #1C2740" }}>
                    <td style={{ padding: "9px 14px", fontFamily: "'JetBrains Mono', monospace" }}>{p.atm_id}</td>
                    <td style={{ padding: "9px 14px", color: "#8B96AC" }}>{p.zone}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: RISK_COLOR(p.risk_score), fontFamily: "'JetBrains Mono', monospace" }}>
                        <Pulse score={p.risk_score} />{p.risk_score}
                      </span>
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>₹{p.current_cash.toLocaleString("en-IN")}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: p.days_to_empty < 2 ? "#EF4B5F" : "#E8ECF4" }}>{p.days_to_empty}d</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>{p.needs_refill ? `₹${p.recommended_fill_amount.toLocaleString("en-IN")}` : "—"}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right" }}>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <Sparkline data={forecasts[p.atm_id]} color={RISK_COLOR(p.risk_score)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 3 && (
        <div className="aopt-panel">
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <StatCard label="Vans deployed" value={<CountUp value={routes.total_vans_needed} />} />
            <StatCard label="ATMs to refill" value={<CountUp value={routes.total_atms_to_refill} />} />
            <StatCard label="Cash to deploy" value={<>₹<CountUp value={routes.total_cash_to_deploy / 10000000} format={v => v.toFixed(2)} />Cr</>} />
            <StatCard label="Total distance" value={<><CountUp value={routes.total_distance_km} format={v => v.toFixed(0)} /> km</>} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <NetworkMap atms={atms} priority={priority} selectedZoneType={""} onSelectAtm={setSelectedAtm} selectedAtm={activeAtm} routes={routes} showRoutes={true} highlightVan={highlightVan} />
              <div style={{ fontSize: 11, color: "#5E6980", marginTop: 8 }}>Dashed lines show optimized van routes (nearest-neighbor + 2-opt), from central vault. Click a van below to isolate its route.</div>
            </div>
            <div style={{ maxHeight: 460, overflowY: "auto" }}>
              {routes.vans.map((van, vi) => {
                const colors = ["#3ED598", "#5DB4F0", "#F5A623", "#C77DFF", "#EF4B5F", "#4ECDC4", "#F5D923"];
                const isActive = highlightVan === van.van_id;
                return (
                  <div key={van.van_id} onClick={() => setHighlightVan(isActive ? null : van.van_id)} style={{
                    background: isActive ? "#16203380" : "#131C2E", border: isActive ? "1px solid #3ED598" : "1px solid #232E45",
                    borderRadius: 10, padding: 14, marginBottom: 10, cursor: "pointer", transition: "all 0.15s ease"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: colors[vi % colors.length], display: "inline-block" }} />
                        {van.van_id}
                      </span>
                      <span style={{ fontSize: 11, color: "#5E6980", fontFamily: "'JetBrains Mono', monospace" }}>{van.num_stops} stops · {van.total_distance_km}km · {van.est_time_hours}h</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#8B96AC", marginBottom: 8 }}>Cash loaded: ₹{van.total_cash_loaded.toLocaleString("en-IN")}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {van.stops.map((s, si) => (
                        <span key={s.atm_id} style={{ fontSize: 11, background: "#0B1220", padding: "3px 8px", borderRadius: 5, fontFamily: "'JetBrains Mono', monospace", color: "#8B96AC" }}>
                          {si + 1}. {s.atm_id}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 4 && (
        <div className="aopt-panel">
          <div style={{ fontSize: 12, color: "#8B96AC", marginBottom: 14 }}>
            Isolation Forest flagged {anomalies.length} unusual withdrawal events across the network — spikes or drains outside the ATM's normal pattern, possible early signals of fraud, skimming, or data issues.
          </div>
          <div style={{ maxHeight: 460, overflowY: "auto", border: "1px solid #232E45", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: "#131C2E" }}>
                  {["ATM", "Zone", "Date", "Withdrawal", "Anomaly score"].map(h => (
                    <th key={h} style={{ textAlign: h === "ATM" || h === "Zone" || h === "Date" ? "left" : "right", padding: "10px 14px", color: "#8B96AC", fontWeight: 500, borderBottom: "1px solid #232E45" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {anomalies.map((a, i) => (
                  <tr key={i} className="aopt-row" style={{ borderBottom: "1px solid #1C2740" }}>
                    <td style={{ padding: "9px 14px", fontFamily: "'JetBrains Mono', monospace" }}>{a.atm_id}</td>
                    <td style={{ padding: "9px 14px", color: "#8B96AC" }}>{a.zone}</td>
                    <td style={{ padding: "9px 14px", fontFamily: "'JetBrains Mono', monospace", color: "#8B96AC" }}>{a.date}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>₹{a.withdrawal_amount.toLocaleString("en-IN")}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#C77DFF" }}>{a.anomaly_score.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}