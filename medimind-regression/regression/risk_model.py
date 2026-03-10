"""
medimind-regression/regression/risk_model.py

Run once to generate risk_rf_model.pkl:
    cd medimind-regression
    python regression/risk_model.py
"""

import os
import numpy as np
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

# Always saves next to this file (regression/risk_rf_model.pkl)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH  = os.path.join(SCRIPT_DIR, 'risk_rf_model.pkl')

FEATURE_NAMES = [
    'bp_sys', 'bp_dia', 'blood_sugar', 'heart_rate', 'temperature', 'weight_change',
    'missed_doses_7d', 'missed_doses_streak', 'medication_adherence_pct',
    'missed_routines_7d', 'routine_adherence_pct',
    'missed_reminders_7d', 'reminder_adherence_pct',
    'missed_appointments_7d', 'total_missed_7d',
    'days_since_last_reading', 'reading_count_7d', 'risk_flag_count_7d',
]

N = 2000  # samples per class


def make_samples(n, risk_level):
    rng = np.random.default_rng(42 + risk_level)

    if risk_level == 0:  # LOW
        bp_sys   = rng.uniform(100, 130, n)
        bp_dia   = rng.uniform(65,  82,  n)
        sugar    = rng.uniform(75,  130, n)
        hr       = rng.uniform(62,  90,  n)
        temp     = rng.uniform(97.5, 99.0, n)
        wt       = rng.uniform(-1,  1,   n)
        md7      = rng.integers(0, 2, n).astype(float)
        streak   = np.zeros(n)
        med_adh  = rng.uniform(90, 100, n)
        mr7      = rng.integers(0, 2, n).astype(float)
        rout_adh = rng.uniform(88, 100, n)
        mrem7    = rng.integers(0, 2, n).astype(float)
        rem_adh  = rng.uniform(88, 100, n)
        appt7    = np.zeros(n)
        total    = rng.integers(0, 3, n).astype(float)
        days_gap = rng.integers(0, 2, n).astype(float)
        r_cnt    = rng.integers(4, 14, n).astype(float)
        flags    = np.zeros(n)

    elif risk_level == 1:  # MEDIUM
        bp_sys   = rng.uniform(130, 155, n)
        bp_dia   = rng.uniform(82,  98,  n)
        sugar    = rng.uniform(130, 200, n)
        hr       = rng.uniform(90,  115, n)
        temp     = rng.uniform(99.0, 101.0, n)
        wt       = rng.uniform(1,   4,   n)
        md7      = rng.integers(2, 5, n).astype(float)
        streak   = rng.integers(1, 3, n).astype(float)
        med_adh  = rng.uniform(65, 89, n)
        mr7      = rng.integers(2, 5, n).astype(float)
        rout_adh = rng.uniform(65, 87, n)
        mrem7    = rng.integers(2, 5, n).astype(float)
        rem_adh  = rng.uniform(65, 87, n)
        appt7    = rng.integers(0, 2, n).astype(float)
        total    = rng.integers(3, 8, n).astype(float)
        days_gap = rng.integers(1, 4, n).astype(float)
        r_cnt    = rng.integers(2, 6, n).astype(float)
        flags    = rng.integers(1, 3, n).astype(float)

    else:  # HIGH
        bp_sys   = rng.uniform(155, 200, n)
        bp_dia   = rng.uniform(98,  130, n)
        sugar    = rng.uniform(200, 400, n)
        hr       = rng.uniform(115, 160, n)
        temp     = rng.uniform(101.0, 105.0, n)
        wt       = rng.uniform(4,   10,  n)
        md7      = rng.integers(5, 8, n).astype(float)
        streak   = rng.integers(3, 8, n).astype(float)
        med_adh  = rng.uniform(0,  64, n)
        mr7      = rng.integers(5, 8, n).astype(float)
        rout_adh = rng.uniform(0,  64, n)
        mrem7    = rng.integers(5, 8, n).astype(float)
        rem_adh  = rng.uniform(0,  64, n)
        appt7    = rng.integers(2, 5, n).astype(float)
        total    = rng.integers(8, 20, n).astype(float)
        days_gap = rng.integers(3, 10, n).astype(float)
        r_cnt    = rng.integers(0, 3, n).astype(float)
        flags    = rng.integers(3, 8, n).astype(float)

    X = np.column_stack([
        bp_sys, bp_dia, sugar, hr, temp, wt,
        md7, streak, med_adh,
        mr7, rout_adh,
        mrem7, rem_adh,
        appt7, total,
        days_gap, r_cnt, flags,
    ])
    y = np.full(n, ['LOW', 'MEDIUM', 'HIGH'][risk_level])
    return X, y


def train_and_save():
    print("Training Random Forest risk model...")

    X0, y0 = make_samples(N, 0)
    X1, y1 = make_samples(N, 1)
    X2, y2 = make_samples(N, 2)

    X_all = np.vstack([X0, X1, X2])
    y_all = np.concatenate([y0, y1, y2])

    X_train, X_test, y_train, y_test = train_test_split(
        X_all, y_all, test_size=0.2, stratify=y_all, random_state=42
    )

    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=12,
        min_samples_leaf=4,
        class_weight='balanced',
        random_state=42,
        n_jobs=-1,
    )
    clf.fit(X_train, y_train)

    print("\nClassification Report (test set):")
    print(classification_report(y_test, clf.predict(X_test),
                                 target_names=['LOW', 'MEDIUM', 'HIGH']))

    bundle = {'model': clf, 'features': FEATURE_NAMES}
    with open(MODEL_PATH, 'wb') as f:
        joblib.dump(bundle, f)

    print(f"\n✅  Model saved → {MODEL_PATH}")
    return clf


if __name__ == '__main__':
    train_and_save()