const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5000/api';

async function handleResponse(res) {
    if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText);
        throw new Error(`API Error (${res.status}): ${errorText || res.statusText}`);
    }
    return res.json();
}

export const fetchATMs = () => fetch(`${API_BASE}/atms`).then(handleResponse);
export const fetchForecasts = () => fetch(`${API_BASE}/forecasts`).then(handleResponse);
export const fetchPriority = (sort = 'risk_score') => fetch(`${API_BASE}/priority?sort=${sort}`).then(handleResponse);
export const fetchAnomalies = () => fetch(`${API_BASE}/anomalies`).then(handleResponse);
export const fetchRoutes = () => fetch(`${API_BASE}/routes`).then(handleResponse);
export const fetchMetrics = () => fetch(`${API_BASE}/metrics`).then(handleResponse);
export const updateCash = (atmId, cash) => 
    fetch(`${API_BASE}/atms/${atmId}/cash`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_cash: cash })
    }).then(handleResponse);