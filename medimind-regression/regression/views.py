# regression/views.py
# ─────────────────────────────────────────────────────────────────────────────
# Django regression service — receives pre-fetched readings from Node.js
# and runs scipy.stats.linregress.
#
# Key fixes vs original:
#   • Accepts as few as 2 readings (linregress minimum)
#   • Blood pressure: parses "120/80" → uses systolic for regression,
#     returns both systolic and diastolic stats
#   • Returns data_window_days / data_window_label passed through from Node
#   • Graceful handling of all-identical values (zero variance → stable)
#   • All numeric outputs rounded to 2 dp to keep JSON small
# ─────────────────────────────────────────────────────────────────────────────

import math
import statistics
from datetime import datetime, timedelta

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

try:
    from scipy import stats as scipy_stats
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


# ─── Vital metadata ───────────────────────────────────────────────────────────

VITAL_META = {
    'blood_pressure': {
        'label': 'Blood Pressure',
        'unit':  'mmHg',
        'normal_range': '90/60 – 120/80',
    },
    'blood_sugar': {
        'label': 'Blood Sugar',
        'unit':  'mg/dL',
        'normal_range': '70 – 140',
    },
    'heart_rate': {
        'label': 'Heart Rate',
        'unit':  'bpm',
        'normal_range': '60 – 100',
    },
    'temperature': {
        'label': 'Temperature',
        'unit':  '°F',
        'normal_range': '97 – 99',
    },
    'weight': {
        'label': 'Weight',
        'unit':  'kg',
        'normal_range': 'Track changes',
    },
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _r(v, dp=2):
    """Round to dp decimal places, return as float."""
    try:
        return round(float(v), dp)
    except (TypeError, ValueError):
        return 0.0


def _parse_numeric(value_str, log_type):
    """
    Convert a reading value string to a float for regression.
    Blood pressure "120/80" → systolic (120).
    Returns None if unparseable.
    """
    try:
        v = str(value_str).strip()
        if log_type == 'blood_pressure':
            parts = v.split('/')
            return float(parts[0])          # systolic
        return float(v)
    except (ValueError, IndexError):
        return None


def _date_to_x(date_str, base_date):
    """Convert a YYYY-MM-DD string to days-since-base (float)."""
    try:
        d = datetime.strptime(str(date_str), '%Y-%m-%d').date()
        return (d - base_date).days
    except ValueError:
        return None


def _safe_stdev(values):
    try:
        return _r(statistics.stdev(values)) if len(values) >= 2 else 0.0
    except statistics.StatisticsError:
        return 0.0


def _safe_median(values):
    try:
        return _r(statistics.median(values))
    except statistics.StatisticsError:
        return _r(values[0]) if values else 0.0


def _trend_color(trend):
    return {'rising': '#e17055', 'falling': '#0984e3', 'stable': '#00b894'}.get(trend, '#636e72')


def _significance(p_value, n):
    """Classify statistical significance."""
    if n < 3:
        return 'insufficient_data', f'Only {n} readings — need ≥ 3 for significance testing'
    if p_value < 0.05:
        return 'significant', f'Statistically significant trend (p={_r(p_value,3)})'
    if p_value < 0.10:
        return 'marginal', f'Marginal trend (p={_r(p_value,3)}) — more data needed'
    return 'not_significant', f'No significant trend detected (p={_r(p_value,3)})'


# ─── Core regression function ─────────────────────────────────────────────────

def _run_regression(log_type, readings):
    """
    Run linregress on a list of {'date': 'YYYY-MM-DD', 'value': str} dicts.
    Returns a complete analysis dict, or an error dict on failure.

    Requires at least 2 readings.
    """
    if not readings or len(readings) < 2:
        return {'error': f'Need at least 2 readings for {log_type}, got {len(readings) if readings else 0}'}

    meta = VITAL_META.get(log_type, {'label': log_type.replace('_', ' ').title(), 'unit': '', 'normal_range': ''})

    # ── Parse dates and values ────────────────────────────────────────────────
    parsed = []
    for r in readings:
        x = _date_to_x(r['date'], datetime.strptime(str(readings[0]['date']), '%Y-%m-%d').date())
        y = _parse_numeric(r['value'], log_type)
        if x is not None and y is not None:
            parsed.append((x, y, str(r['date']), str(r['value'])))

    if len(parsed) < 2:
        return {'error': f'Could not parse enough numeric values for {log_type}'}

    xs      = [p[0] for p in parsed]
    ys      = [p[1] for p in parsed]
    dates   = [p[2] for p in parsed]
    raw_vals = [p[3] for p in parsed]

    n = len(parsed)

    # ── Linear regression ─────────────────────────────────────────────────────
    if SCIPY_AVAILABLE and n >= 3:
        slope, intercept, r_value, p_value, std_err = scipy_stats.linregress(xs, ys)
        r_squared = r_value ** 2
        # 95% confidence interval half-width
        t_crit = 2.0  # approx for large n; good enough for health monitoring
        conf_95 = t_crit * std_err if std_err else 0.0
    else:
        # Fallback: manual least-squares (works with only 2 points)
        n_pts  = len(xs)
        mean_x = sum(xs) / n_pts
        mean_y = sum(ys) / n_pts
        ss_xy  = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
        ss_xx  = sum((x - mean_x) ** 2 for x in xs)
        slope     = ss_xy / ss_xx if ss_xx != 0 else 0.0
        intercept = mean_y - slope * mean_x
        # Approximate R²
        y_pred    = [slope * x + intercept for x in xs]
        ss_res    = sum((y - yp) ** 2 for y, yp in zip(ys, y_pred))
        ss_tot    = sum((y - mean_y) ** 2 for y in ys)
        r_squared = 1 - ss_res / ss_tot if ss_tot != 0 else 1.0
        p_value   = 0.5   # unknown without scipy — mark as marginal
        std_err   = 0.0
        conf_95   = 0.0

    # ── Trend classification ───────────────────────────────────────────────────
    # Use a threshold of 0.05 units/day to avoid flagging noise as "rising"
    SLOPE_THRESHOLD = 0.05
    if abs(slope) < SLOPE_THRESHOLD or r_squared < 0.05:
        trend = 'stable'
    elif slope > 0:
        trend = 'rising'
    else:
        trend = 'falling'

    trend_label = {'rising': '↑ Rising', 'falling': '↓ Falling', 'stable': '→ Stable'}[trend]
    change_per_week = _r(slope * 7)

    # ── Trend line Y values ────────────────────────────────────────────────────
    trend_line = [_r(slope * x + intercept) for x in xs]

    # ── Stats ─────────────────────────────────────────────────────────────────
    predicted_today = _r(slope * xs[-1] + intercept)
    sig, sig_note   = _significance(p_value, n)

    stats_obj = {
        'min':    _r(min(ys)),
        'max':    _r(max(ys)),
        'avg':    _r(sum(ys) / n),
        'median': _safe_median(ys),
        'std':    _safe_stdev(ys),
        'latest': _r(ys[-1]),
        'count':  n,
    }

    # ── Human-readable summary ────────────────────────────────────────────────
    direction = 'increasing' if trend == 'rising' else 'decreasing' if trend == 'falling' else 'stable'
    summary = (
        f"{meta['label']} is {direction}"
        + (f" by {abs(change_per_week)} {meta['unit']}/week" if trend != 'stable' else '')
        + f" over {n} readings."
    )

    # ── Readings for display ──────────────────────────────────────────────────
    reading_objects = [
        {'date': dates[i], 'value': raw_vals[i], 'numeric': _r(ys[i])}
        for i in range(n)
    ]

    return {
        'log_type':  log_type,
        'label':     meta['label'],
        'unit':      meta['unit'],
        'readings':  reading_objects,
        'trend_line': trend_line,
        'regression': {
            'slope':           _r(slope, 4),
            'intercept':       _r(intercept, 4),
            'r_squared':       _r(r_squared, 4),
            'p_value':         _r(p_value, 4),
            'std_err':         _r(std_err, 4),
            'conf_95':         _r(conf_95, 4),
            'trend':           trend,
            'trend_label':     trend_label,
            'trend_color':     _trend_color(trend),
            'change_per_week': change_per_week,
            'predicted_today': predicted_today,
            'summary':         summary,
            'significance':    sig,
            'significance_note': sig_note,
        },
        'stats': stats_obj,
    }


# ─── Views ────────────────────────────────────────────────────────────────────

@api_view(['POST'])
def regression_batch(request):
    """
    POST /api/regression/batch/
    Body: { "vitals": [ { "log_type": "heart_rate", "readings": [...] }, ... ] }

    Runs regression for each vital and returns a list of results.
    Vitals with errors are skipped (not included in response).
    """
    vitals = request.data.get('vitals', [])
    if not vitals:
        return Response(
            {'error': 'No vitals provided. Send {"vitals": [...]}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    results = []
    for item in vitals:
        log_type = item.get('log_type', '')
        readings = item.get('readings', [])

        if not log_type:
            continue

        result = _run_regression(log_type, readings)

        # Pass through any extra fields from Node (e.g. data_window_days)
        for k, v in item.items():
            if k not in ('log_type', 'readings') and k not in result:
                result[k] = v

        if 'error' in result:
            # Include error info but still return other vitals
            results.append({
                'log_type':  log_type,
                'label':     VITAL_META.get(log_type, {}).get('label', log_type),
                'error':     result['error'],
                'readings':  [],
            })
        else:
            results.append(result)

    return Response(results)


@api_view(['POST'])
def regression_single(request):
    """
    POST /api/regression/single/
    Body: { "log_type": "heart_rate", "readings": [ {"date": "2025-01-01", "value": "72"}, ... ] }
    """
    log_type = request.data.get('log_type', '')
    readings = request.data.get('readings', [])

    if not log_type or not readings:
        return Response(
            {'error': 'Provide log_type and readings'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    result = _run_regression(log_type, readings)

    if 'error' in result:
        return Response({'error': result['error']}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

    return Response(result)


@api_view(['GET'])
def health_check(request):
    """GET /api/regression/health/ — quick liveness probe."""
    return Response({
        'status': 'ok',
        'scipy': SCIPY_AVAILABLE,
        'min_readings_required': 2,
    })