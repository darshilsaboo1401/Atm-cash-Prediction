const express = require('express');
const cors = require('cors');
const db = require('./database');

const app = express();
app.use(cors());
app.use(express.json());

// Helper: convert SQLite row to proper JS types
function fixAtmRow(r) {
    return {
        ...r,
        lat: Number(r.lat),
        lon: Number(r.lon),
        capacity: Number(r.capacity),
        min_threshold: Number(r.min_threshold),
        current_cash: Number(r.current_cash),
        capacity_ratio: Number(r.capacity_ratio),
        days_to_empty: Number(r.days_to_empty),
        avg_daily_forecast: Number(r.avg_daily_forecast),
        risk_score: Number(r.risk_score),
        needs_refill: Boolean(r.needs_refill),
        recommended_fill_amount: Number(r.recommended_fill_amount)
    };
}
// ========== ADD THESE FUNCTIONS (after fixAtmRow) ==========

function toRad(deg) {
    return deg * (Math.PI / 180);
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return +(R * c).toFixed(1);
}

function calculateVanDistance(stops, depot) {
    if (!stops || stops.length === 0) return 0;
    let total = 0;
    // Depot → first stop
    total += haversineDistance(depot.lat, depot.lon, stops[0].lat, stops[0].lon);
    // Between consecutive stops
    for (let i = 0; i < stops.length - 1; i++) {
        total += haversineDistance(stops[i].lat, stops[i].lon, stops[i + 1].lat, stops[i + 1].lon);
    }
    // Last stop → depot (return journey)
    total += haversineDistance(stops[stops.length - 1].lat, stops[stops.length - 1].lon, depot.lat, depot.lon);
    return +total.toFixed(1);
}

// ───────────────────────────────────────────
// 1. GET all ATMs with priority status
// ───────────────────────────────────────────
app.get('/api/atms', (req, res) => {
    const query = `
        SELECT a.*, p.current_cash, p.capacity_ratio, p.days_to_empty,
               p.risk_score, p.needs_refill, p.recommended_fill_amount
        FROM atms a
        LEFT JOIN priority p ON a.atm_id = p.atm_id
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(fixAtmRow));
    });
});

// ───────────────────────────────────────────
// 2. GET single ATM details
// ───────────────────────────────────────────
app.get('/api/atms/:atmId', (req, res) => {
    const query = `
        SELECT a.*, p.* FROM atms a
        LEFT JOIN priority p ON a.atm_id = p.atm_id
        WHERE a.atm_id = ?
    `;
    db.get(query, [req.params.atmId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'ATM not found' });
        res.json(fixAtmRow(row));
    });
});

// ───────────────────────────────────────────
// 3. GET forecasts for specific ATM
// ───────────────────────────────────────────
app.get('/api/forecasts/:atmId', (req, res) => {
    db.all(
        'SELECT date, predicted_withdrawal FROM forecasts WHERE atm_id = ? ORDER BY date',
        [req.params.atmId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// ───────────────────────────────────────────
// 4. GET all forecasts (grouped by ATM)
// ───────────────────────────────────────────
app.get('/api/forecasts', (req, res) => {
    db.all('SELECT * FROM forecasts ORDER BY atm_id, date', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const grouped = {};
        rows.forEach(r => {
            if (!grouped[r.atm_id]) grouped[r.atm_id] = [];
            grouped[r.atm_id].push({ date: r.date, predicted_withdrawal: Number(r.predicted_withdrawal) });
        });
        res.json(grouped);
    });
});

// ───────────────────────────────────────────
// 5. GET priority list
// ───────────────────────────────────────────
app.get('/api/priority', (req, res) => {
    const { sort = 'risk_score', order = 'DESC' } = req.query;
    const validSorts = ['risk_score', 'days_to_empty', 'current_cash', 'recommended_fill_amount'];
    const sortCol = validSorts.includes(sort) ? sort : 'risk_score';
    const sortOrder = order.toString().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    db.all(
        `SELECT a.*, p.current_cash, p.capacity_ratio, p.days_to_empty,
                p.avg_daily_forecast, p.risk_score, p.needs_refill, p.recommended_fill_amount
         FROM priority p
         JOIN atms a ON p.atm_id = a.atm_id
         ORDER BY p.${sortCol} ${sortOrder}`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows.map(fixAtmRow));
        }
    );
});


// ───────────────────────────────────────────
// 6. GET anomalies
// ───────────────────────────────────────────
app.get('/api/anomalies', (req, res) => {
    db.all('SELECT * FROM anomalies ORDER BY date DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => ({
            ...r,
            withdrawal_amount: Number(r.withdrawal_amount),
            anomaly_score: Number(r.anomaly_score)
        })));
    });
});

// ───────────────────────────────────────────
// 7. GET routes
// ───────────────────────────────────────────
app.get('/api/routes', (req, res) => {
    db.get(
        'SELECT * FROM route_plans ORDER BY created_at DESC LIMIT 1',
        [],
        (err, plan) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!plan) return res.status(404).json({ error: 'No routes found' });

            db.all(
                `SELECT vs.*, a.zone as atm_zone FROM van_stops vs
                 LEFT JOIN atms a ON vs.atm_id = a.atm_id
                 WHERE vs.plan_id = ? ORDER BY vs.van_id, vs.stop_order`,
                [plan.plan_id],
                (err, stops) => {
                    if (err) return res.status(500).json({ error: err.message });

                    const vans = {};
                    stops.forEach(s => {
                        if (!vans[s.van_id]) {
                            vans[s.van_id] = {
                                van_id: s.van_id,
                                stops: [],
                                total_cash_loaded: 0,
                                total_distance_km: 0,
                                est_time_hours: 0,
                                num_stops: 0
                            };
                        }
                        vans[s.van_id].stops.push({
                            atm_id: s.atm_id,
                            zone: s.zone || s.atm_zone,
                            lat: Number(s.lat),
                            lon: Number(s.lon),
                            fill_amount: Number(s.fill_amount),
                            risk_score: Number(s.risk_score)
                        });
                        vans[s.van_id].num_stops += 1;
                        vans[s.van_id].total_cash_loaded += Number(s.fill_amount) || 0;
                    });

                    // Calculate distance & time per van using haversine formula
                    const depot = { lat: Number(plan.depot_lat), lon: Number(plan.depot_lon) };
                    
                    const vanList = Object.values(vans).map(v => {
                        v.total_distance_km = calculateVanDistance(v.stops, depot);
                        v.est_time_hours = +(v.num_stops * 0.4 + (v.total_distance_km / 40)).toFixed(1);
                        return v;
                    });

                    res.json({
                        depot: { lat: Number(plan.depot_lat), lon: Number(plan.depot_lon), name: plan.depot_name },
                        van_capacity: Number(plan.van_capacity),
                        total_vans_needed: Number(plan.total_vans_needed),
                        total_atms_to_refill: Number(plan.total_atms_to_refill),
                        total_cash_to_deploy: Number(plan.total_cash_to_deploy),
                        total_distance_km: Number(plan.total_distance_km),
                        vans: vanList
                    });
                }
            );
        }
    );
});

// ───────────────────────────────────────────
// 8. GET model metrics
// ───────────────────────────────────────────
app.get('/api/metrics', (req, res) => {
    db.get(
        'SELECT * FROM model_metrics ORDER BY recorded_at DESC LIMIT 1',
        [],
        (err, metrics) => {
            if (err || !metrics) return res.status(500).json({ error: 'No metrics found' });

            db.all(
                'SELECT feature_name, importance_score FROM feature_importance WHERE metric_id = ?',
                [metrics.id],
                (err, features) => {
                    if (err) return res.status(500).json({ error: err.message });

                    const feature_importance = {};
                    features.forEach(f => feature_importance[f.feature_name] = Number(f.importance_score));

                    res.json({
                        mae: Number(metrics.mae),
                        mape: Number(metrics.mape),
                        r2: Number(metrics.r2),
                        training_samples: Number(metrics.training_samples),
                        n_atms: Number(metrics.n_atms),
                        anomalies_detected: Number(metrics.anomalies_detected),
                        feature_importance
                    });
                }
            );
        }
    );
});

// ───────────────────────────────────────────
// 9. PATCH update ATM cash
// ───────────────────────────────────────────
app.patch('/api/atms/:atmId/cash', (req, res) => {
    const { current_cash } = req.body;
    if (current_cash === undefined || isNaN(Number(current_cash))) {
        return res.status(400).json({ error: 'Valid numeric current_cash is required' });
    }

    const cash = Number(current_cash);
    const atmId = req.params.atmId;

    // Fetch ATM capacity, threshold, and forecast to recalculate priority metrics
    const query = `
        SELECT a.capacity, a.min_threshold, p.avg_daily_forecast
        FROM atms a
        LEFT JOIN priority p ON a.atm_id = p.atm_id
        WHERE a.atm_id = ?
    `;

    db.get(query, [atmId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'ATM not found' });

        const capacity = row.capacity || 1;
        const minThreshold = row.min_threshold || 0;
        const avgForecast = row.avg_daily_forecast || 100000;

        const capacity_ratio = +(cash / capacity).toFixed(3);
        const days_to_empty = avgForecast > 0 ? +(cash / avgForecast).toFixed(1) : 99;
        const needs_refill = cash < minThreshold ? 1 : 0;
        const recommended_fill_amount = needs_refill ? Math.max(0, capacity - cash) : 0;

        // Calculate risk score based on capacity ratio and days to empty
        let risk_score = 0;
        if (days_to_empty < 1) risk_score = 85 + Math.min(15, (1 - days_to_empty) * 15);
        else if (days_to_empty < 2) risk_score = 65 + (2 - days_to_empty) * 15;
        else if (days_to_empty < 4) risk_score = 40 + (4 - days_to_empty) * 10;
        else risk_score = Math.max(5, 30 - days_to_empty * 2);

        risk_score = Math.round(risk_score);

        db.run(
            `UPDATE priority SET 
                current_cash = ?, 
                capacity_ratio = ?, 
                days_to_empty = ?, 
                needs_refill = ?, 
                recommended_fill_amount = ?, 
                risk_score = ?, 
                last_updated = CURRENT_TIMESTAMP 
             WHERE atm_id = ?`,
            [cash, capacity_ratio, days_to_empty, needs_refill, recommended_fill_amount, risk_score, atmId],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: 'ATM priority row not found' });
                res.json({
                    updated: true,
                    atm_id: atmId,
                    current_cash: cash,
                    capacity_ratio,
                    days_to_empty,
                    needs_refill: Boolean(needs_refill),
                    recommended_fill_amount,
                    risk_score
                });
            }
        );
    });
});

// ───────────────────────────────────────────
// 10. POST recalculate priority
// ───────────────────────────────────────────
app.post('/api/priority/recalculate', (req, res) => {
    const updateQuery = `
        UPDATE priority 
        SET last_updated = CURRENT_TIMESTAMP
    `;
    db.run(updateQuery, [], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Priority recalculation completed', affected: this.changes });
    });
});


// ───────────────────────────────────────────
// Health check
// ───────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log('\n🚀 ATM Optimizer Backend running');
    console.log(`   API: http://localhost:${PORT}/api`);
    console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});