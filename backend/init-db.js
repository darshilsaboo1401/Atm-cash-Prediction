const db = require('./database');
const DATA = require('./atm_data.json');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS atms (
    atm_id TEXT PRIMARY KEY,
    zone TEXT NOT NULL,
    zone_type TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    capacity INTEGER NOT NULL,
    min_threshold INTEGER NOT NULL,
    bank_branch TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    atm_id TEXT NOT NULL,
    date TEXT NOT NULL,
    predicted_withdrawal REAL NOT NULL,
    FOREIGN KEY (atm_id) REFERENCES atms(atm_id),
    UNIQUE(atm_id, date)
);

CREATE TABLE IF NOT EXISTS anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    atm_id TEXT NOT NULL,
    date TEXT NOT NULL,
    withdrawal_amount REAL NOT NULL,
    anomaly_score REAL NOT NULL,
    zone TEXT NOT NULL,
    FOREIGN KEY (atm_id) REFERENCES atms(atm_id)
);

CREATE TABLE IF NOT EXISTS priority (
    atm_id TEXT PRIMARY KEY,
    current_cash INTEGER NOT NULL DEFAULT 0,
    capacity_ratio REAL NOT NULL DEFAULT 0,
    days_to_empty REAL NOT NULL DEFAULT 0,
    avg_daily_forecast REAL NOT NULL DEFAULT 0,
    risk_score REAL NOT NULL DEFAULT 0,
    needs_refill INTEGER NOT NULL DEFAULT 0,
    recommended_fill_amount INTEGER NOT NULL DEFAULT 0,
    last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (atm_id) REFERENCES atms(atm_id)
);

CREATE TABLE IF NOT EXISTS route_plans (
    plan_id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    total_vans_needed INTEGER NOT NULL,
    total_atms_to_refill INTEGER NOT NULL,
    total_cash_to_deploy INTEGER NOT NULL,
    total_distance_km REAL NOT NULL,
    van_capacity INTEGER NOT NULL,
    depot_lat REAL NOT NULL,
    depot_lon REAL NOT NULL,
    depot_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS van_stops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    van_id TEXT NOT NULL,
    stop_order INTEGER NOT NULL,
    atm_id TEXT,
    zone TEXT,
    lat REAL,
    lon REAL,
    fill_amount INTEGER,
    risk_score REAL,
    FOREIGN KEY (plan_id) REFERENCES route_plans(plan_id),
    FOREIGN KEY (atm_id) REFERENCES atms(atm_id)
);

CREATE TABLE IF NOT EXISTS model_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    mae REAL NOT NULL,
    mape REAL NOT NULL,
    r2 REAL NOT NULL,
    training_samples INTEGER NOT NULL,
    n_atms INTEGER NOT NULL,
    anomalies_detected INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_importance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_id INTEGER NOT NULL,
    feature_name TEXT NOT NULL,
    importance_score REAL NOT NULL,
    FOREIGN KEY (metric_id) REFERENCES model_metrics(id)
);
`;

function seedDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // 1. Seed ATMs
            const atmStmt = db.prepare(`
                INSERT OR REPLACE INTO atms (atm_id, zone, zone_type, lat, lon, capacity, min_threshold, bank_branch)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            DATA.atms.forEach(a => {
                atmStmt.run(a.atm_id, a.zone, a.zone_type, a.lat, a.lon, a.capacity, a.min_threshold, a.bank_branch);
            });
            atmStmt.finalize();

            // 2. Seed Forecasts
            const foreStmt = db.prepare(`
                INSERT OR REPLACE INTO forecasts (atm_id, date, predicted_withdrawal)
                VALUES (?, ?, ?)
            `);
            Object.entries(DATA.forecasts).forEach(([atmId, days]) => {
                days.forEach(day => {
                    foreStmt.run(atmId, day.date, day.predicted_withdrawal);
                });
            });
            foreStmt.finalize();

            // 3. Seed Anomalies
            const anomStmt = db.prepare(`
                INSERT INTO anomalies (atm_id, date, withdrawal_amount, anomaly_score, zone)
                VALUES (?, ?, ?, ?, ?)
            `);
            DATA.anomalies.forEach(a => {
                anomStmt.run(a.atm_id, a.date, a.withdrawal_amount, a.anomaly_score, a.zone);
            });
            anomStmt.finalize();

            // 4. Seed Priority
            const priStmt = db.prepare(`
                INSERT OR REPLACE INTO priority 
                (atm_id, current_cash, capacity_ratio, days_to_empty, avg_daily_forecast, risk_score, needs_refill, recommended_fill_amount)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            DATA.priority.forEach(p => {
                priStmt.run(p.atm_id, p.current_cash, p.capacity_ratio, p.days_to_empty,
                    p.avg_daily_forecast, p.risk_score, p.needs_refill ? 1 : 0, p.recommended_fill_amount);
            });
            priStmt.finalize();

            // 5. Seed Routes
            const routeStmt = db.prepare(`
                INSERT INTO route_plans (total_vans_needed, total_atms_to_refill, total_cash_to_deploy, total_distance_km, van_capacity, depot_lat, depot_lon, depot_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            routeStmt.run(
                DATA.routes.total_vans_needed,
                DATA.routes.total_atms_to_refill,
                DATA.routes.total_cash_to_deploy,
                DATA.routes.total_distance_km,
                DATA.routes.van_capacity,
                DATA.routes.depot.lat,
                DATA.routes.depot.lon,
                DATA.routes.depot.name,
                function(err) {
                    if (err) { reject(err); return; }
                    const planId = this.lastID;

                    const stopStmt = db.prepare(`
                        INSERT INTO van_stops (plan_id, van_id, stop_order, atm_id, zone, lat, lon, fill_amount, risk_score)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);
                    DATA.routes.vans.forEach(van => {
                        van.stops.forEach((stop, idx) => {
                            stopStmt.run(planId, van.van_id, idx + 1, stop.atm_id, stop.zone,
                                stop.lat, stop.lon, stop.fill_amount, stop.risk_score);
                        });
                    });
                    stopStmt.finalize();
                }
            );
            routeStmt.finalize();

            // 6. Seed Metrics
            const metStmt = db.prepare(`
                INSERT INTO model_metrics (mae, mape, r2, training_samples, n_atms, anomalies_detected)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            metStmt.run(
                DATA.metrics.mae,
                DATA.metrics.mape,
                DATA.metrics.r2,
                DATA.metrics.training_samples,
                DATA.metrics.n_atms,
                DATA.metrics.anomalies_detected,
                function(err) {
                    if (err) { reject(err); return; }
                    const metricId = this.lastID;

                    const featStmt = db.prepare(`
                        INSERT INTO feature_importance (metric_id, feature_name, importance_score)
                        VALUES (?, ?, ?)
                    `);
                    Object.entries(DATA.metrics.feature_importance).forEach(([feature, score]) => {
                        featStmt.run(metricId, feature, score);
                    });
                    featStmt.finalize(() => resolve());
                }
            );
            metStmt.finalize();
        });
    });
}

// Run everything
db.exec(SCHEMA, async (err) => {
    if (err) {
        console.error('❌ Schema creation failed:', err.message);
        db.close();
        return;
    }
    console.log('✅ Database schema created');

    try {
        await seedDatabase();
        console.log('✅ All data seeded successfully!');
    } catch (seedErr) {
        console.error('❌ Seeding failed:', seedErr.message);
    } finally {
        db.close();
    }
});
