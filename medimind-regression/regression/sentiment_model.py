# regression/sentiment_model.py
# =============================================================================
# MediMind — Emotional Well-being Sentiment Analysis
# Model  : Logistic Regression (sklearn)
# Labels :
#   0 = POSITIVE    😊  score 0-30
#   1 = NEUTRAL     😐  score 31-55
#   2 = CONCERNING  ⚠️  score 56-75   -> caregiver alert
#   3 = CRITICAL    🚨  score 76-100  -> immediate caregiver alert
#
# Features (8 total):
#   mood_score          - numeric weight of selected mood  (0.0-1.0)
#   text_polarity       - custom lexicon polarity          (-1.0-1.0)
#   negative_word_count - normalised neg keyword count     (0.0-1.0)
#   positive_word_count - normalised pos keyword count     (0.0-1.0)
#   notes_length_norm   - note length / 200 capped at 1.0
#   has_notes           - 1 if notes present, 0 if not
#   mood_streak_norm    - consecutive negative moods / 7   (0.0-1.0)
#   hour_norm           - hour_of_day / 23                 (0.0-1.0)
#
# Scoring strategy:
#   WITH notes    : mood(40%) + text_polarity(35%) + keywords(15%) + context(10%)
#   WITHOUT notes : mood(70%) + context(30%)  [streak + hour]
# =============================================================================

import os
import pickle
import random
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH  = os.path.join(SCRIPT_DIR, 'sentiment_lr_model.pkl')

# =============================================================================
# MOOD NUMERIC SCORES
# =============================================================================
MOOD_SCORES = {
    'happy':   1.00,
    'neutral': 0.55,
    'tired':   0.35,
    'anxious': 0.20,
    'sad':     0.10,
    'lonely':  0.05,
}

# =============================================================================
# INLINE SENTIMENT LEXICON  (no external NLP dependency)
# =============================================================================
NEGATIVE_WORDS = {
    'pain','hurt','ache','sore','awful','terrible','horrible','worse','worst',
    'dreadful','miserable','suffering','agony','unbearable','alone','lonely',
    'scared','afraid','fear','worried','worry','anxious','nervous','sad',
    'unhappy','depressed','hopeless','helpless','useless','worthless',
    'forgotten','ignored','cry','crying','tears','hate','angry','mad',
    'furious','exhausted','drained','weak','sick','miss','missing','lost',
    'confused','dizzy','nauseous','nobody','nothing','never','cant',
    'dark','empty','hollow','pointless','difficult','hard','die','dying',
    'death','dead','end','over','finished','harm','dangerous','bored',
    'frustrated','disappointed','regret','guilty','ashamed','embarrassed',
}
POSITIVE_WORDS = {
    'happy','good','great','wonderful','excellent','amazing','fantastic',
    'better','best','well','fine','okay','nice','lovely','beautiful','joy',
    'joyful','glad','grateful','thankful','blessed','love','peaceful','calm',
    'relaxed','rested','comfortable','healthy','strong','energetic','active',
    'enjoyed','enjoy','fun','smile','laugh','family','friends','visit',
    'walked','ate','slept','sleep','normal','usual','stable','steady',
    'improving','refreshed','content','satisfied','cheerful','hopeful',
    'positive','productive','accomplished','proud','excited','curious',
}
CRISIS_PHRASES = [
    'want to die','end it all','no reason to live','nobody cares',
    'all alone','completely alone','give up on life','cant go on',
    "can't go on",'no point','wish i was dead','feel like dying',
    'completely hopeless','nobody loves','nobody notices',
    'want to disappear','no will to live',
]

# =============================================================================
# FEATURE EXTRACTION
# =============================================================================
def extract_text_features(notes):
    if not notes or not notes.strip():
        return {
            'text_polarity':       0.0,
            'negative_word_count': 0.0,
            'positive_word_count': 0.0,
            'notes_length_norm':   0.0,
            'has_notes':           0,
            'has_crisis':          0,
        }

    text  = notes.lower().strip()
    clean = text.replace(',','').replace('.','').replace('!','') \
                .replace('?','').replace(';','')
    words = clean.split()

    neg_count = sum(1 for w in words if w in NEGATIVE_WORDS)
    pos_count = sum(1 for w in words if w in POSITIVE_WORDS)
    total     = max(len(words), 1)

    polarity   = max(-1.0, min(1.0, (pos_count - neg_count) / total))
    has_crisis = int(any(phrase in text for phrase in CRISIS_PHRASES))

    return {
        'text_polarity':       round(polarity, 4),
        'negative_word_count': round(min(neg_count / max(total, 1), 1.0), 4),
        'positive_word_count': round(min(pos_count / max(total, 1), 1.0), 4),
        'notes_length_norm':   round(min(len(notes) / 200.0, 1.0), 4),
        'has_notes':           1,
        'has_crisis':          has_crisis,
    }


def build_feature_vector(mood, notes, mood_streak=0, hour=12):
    mood_score  = MOOD_SCORES.get(str(mood).lower(), 0.5)
    text_feats  = extract_text_features(notes)
    streak_norm = min(mood_streak / 7.0, 1.0)
    hour_norm   = hour / 23.0

    if not text_feats['has_notes']:
        return np.array([
            mood_score,
            0.0, 0.0, 0.0, 0.0, 0,
            streak_norm,
            hour_norm,
        ], dtype=float)

    return np.array([
        mood_score,
        text_feats['text_polarity'],
        text_feats['negative_word_count'],
        text_feats['positive_word_count'],
        text_feats['notes_length_norm'],
        1,
        streak_norm,
        hour_norm,
    ], dtype=float)


# =============================================================================
# SYNTHETIC TRAINING DATA
# =============================================================================
def make_samples():
    random.seed(42)
    np.random.seed(42)
    samples, labels = [], []

    def add(mood, notes, streak, hour, label, n=1):
        for _ in range(n):
            jitter = np.random.normal(0, 0.03, 8)
            vec    = build_feature_vector(mood, notes, streak, hour) + jitter
            vec    = np.clip(vec, -1.0, 1.5)
            samples.append(vec)
            labels.append(label)

    # ── LABEL 0: POSITIVE ────────────────────────────────────────────────────
    pos_notes = [
        "Feeling great today! Went for a walk.",
        "Had a wonderful visit from my grandchildren.",
        "Enjoyed my breakfast and felt rested.",
        "Watched my favourite show, feeling happy.",
        "Spoke to my daughter on the phone, very happy.",
        "Slept well and feeling strong today.",
        "The garden looks beautiful today.",
        "Ate a good meal and feeling calm.",
        "Everything is normal today.",
        "Feeling blessed and grateful.",
        "Good morning! Ready for the day.",
        "Had tea with my neighbor, lovely time.",
        "Went to church, feeling at peace.",
        "Family visited today, wonderful day.",
        "Feeling content and comfortable.",
    ]
    for note in pos_notes:
        add('happy',   note, 0, random.randint(8, 18), 0, n=6)
    for note in pos_notes[:6]:
        add('neutral', note, 0, random.randint(8, 18), 0, n=3)
    add('happy',   "", 0, 10, 0, n=15)
    add('neutral', "", 0, 11, 0, n=6)

    # ── LABEL 1: NEUTRAL ─────────────────────────────────────────────────────
    neu_notes = [
        "Just another day.",
        "Nothing special today.",
        "Feeling okay, not great not bad.",
        "Had lunch, watched TV.",
        "Resting at home.",
        "Did some reading.",
        "Normal day.",
        "Feeling a bit tired but okay.",
        "Stayed home, nothing much.",
        "Just going through the motions.",
    ]
    for note in neu_notes:
        add('neutral', note, 0, random.randint(9, 20), 1, n=6)
    add('tired',   "", 0, random.randint(14, 22), 1, n=12)
    add('tired',   "Just tired today, nothing serious.", 1, 15, 1, n=6)
    add('neutral', "", 1, 12, 1, n=8)
    add('happy',   "Feeling okay.", 0, 10, 1, n=3)

    # ── LABEL 2: CONCERNING ──────────────────────────────────────────────────
    con_notes = [
        "Feeling very sad today. Miss my family.",
        "I feel so alone. Nobody visited.",
        "Anxious about my health results.",
        "Couldn't sleep, very worried.",
        "Missing my late husband today.",
        "Everything feels hard lately.",
        "I feel like a burden to everyone.",
        "Very nervous about tomorrow's appointment.",
        "Feeling down and don't know why.",
        "Nobody called today, feeling ignored.",
        "I cried a little today.",
        "Feeling scared about being alone.",
        "My body hurts and I feel weak.",
        "I feel forgotten.",
        "Today was difficult. Very tired and sad.",
        "I miss having people around me.",
        "Feeling hopeless about my health.",
        "I am worried about my future.",
    ]
    for note in con_notes:
        add('sad',     note, random.randint(1, 3), random.randint(6, 23), 2, n=5)
        add('anxious', note, random.randint(1, 3), random.randint(6, 23), 2, n=4)
        add('lonely',  note, random.randint(1, 3), random.randint(6, 23), 2, n=4)
    add('sad',    "", 2, random.randint(18, 23), 2, n=10)
    add('anxious',"", 2, random.randint(18, 23), 2, n=10)
    add('lonely', "", 3, random.randint(18, 23), 2, n=10)
    add('sad',    "", 3, random.randint(0,  7),  2, n=8)

    # ── LABEL 3: CRITICAL ────────────────────────────────────────────────────
    crit_notes = [
        "I feel completely hopeless. What is the point anymore.",
        "I don't want to be here anymore.",
        "Nobody cares about me. I am all alone.",
        "I feel like dying. Everything hurts.",
        "Cant go on like this. I give up.",
        "I am completely alone and nobody loves me.",
        "I wish I was dead. Life has no meaning.",
        "I am so depressed I cannot do anything.",
        "I hate everything. I feel like ending it.",
        "I am scared and alone and there is no hope.",
        "I feel like a burden. Everyone would be better without me.",
        "I am crying and cannot stop. I feel so hopeless.",
        "Nobody visits me. I want to die.",
        "Completely lost the will to live.",
        "I want to disappear. Everything is dark.",
        "I have no reason to live anymore.",
        "Nobody loves me and I am completely alone.",
    ]
    for note in crit_notes:
        add('sad',     note, random.randint(3, 7), random.randint(0, 23), 3, n=6)
        add('lonely',  note, random.randint(3, 7), random.randint(0, 23), 3, n=5)
        add('anxious', note, random.randint(4, 7), random.randint(0,  6), 3, n=5)
    add('sad',    "", 6, random.randint(0, 5),   3, n=8)
    add('lonely', "", 7, random.randint(0, 5),   3, n=8)
    add('sad',    "", 5, random.randint(20, 23), 3, n=6)

    return np.array(samples), np.array(labels)


# =============================================================================
# TRAIN AND SAVE
# =============================================================================
def train_and_save():
    print("Generating training data...")
    X, y = make_samples()
    print(f"  Total samples : {len(X)}")
    print(f"  Label dist    : { {i: int((y==i).sum()) for i in range(4)} }")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = Pipeline([
        ('scaler', StandardScaler()),
        ('clf',    LogisticRegression(
            solver='lbfgs',
            max_iter=1000,
            C=1.0,
            random_state=42,
        )),
    ])

    print("Training Logistic Regression...")
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    print("\nClassification Report:")
    print(classification_report(
        y_test, y_pred,
        target_names=['POSITIVE', 'NEUTRAL', 'CONCERNING', 'CRITICAL']
    ))

    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(model, f)
    print(f"Model saved -> {MODEL_PATH}")
    return model


# =============================================================================
# LABEL METADATA — advice shown to caregiver
# =============================================================================
LABEL_META = {
    0: {
        'label':    'POSITIVE',
        'emoji':    '😊',
        'color':    '#00b894',
        'priority': 'low',
        'alert':    False,
        'advice': [
            "Keep up the positive routines — they clearly help.",
            "Great to see a positive mood. Encourage the elder to share what made today good.",
            "Mood is stable and positive. No action needed.",
        ],
    },
    1: {
        'label':    'NEUTRAL',
        'emoji':    '😐',
        'color':    '#74b9ff',
        'priority': 'low',
        'alert':    False,
        'advice': [
            "Mood is neutral. Consider a short check-in call today.",
            "A calm day — encourage a small enjoyable activity if possible.",
            "Neutral mood. Light social interaction can help elevate spirits.",
        ],
    },
    2: {
        'label':    'CONCERNING',
        'emoji':    '⚠️',
        'color':    '#fdcb6e',
        'priority': 'high',
        'alert':    True,
        'advice': [
            "The elder seems sad or anxious. A phone call or visit today would help greatly.",
            "Signs of loneliness detected. Try arranging a social activity or family visit.",
            "Emotional distress signals present. Ask directly how they are feeling today.",
            "Consider reviewing medication — missed doses can affect mood significantly.",
            "If sadness persists over 3+ days, consult a healthcare professional.",
        ],
    },
    3: {
        'label':    'CRITICAL',
        'emoji':    '🚨',
        'color':    '#ff4757',
        'priority': 'critical',
        'alert':    True,
        'advice': [
            "URGENT: The elder may be in severe emotional distress. Immediate contact is strongly advised.",
            "Crisis signals detected. Please call or visit the elder right away.",
            "This level of distress may indicate a mental health emergency. Contact the elder now.",
            "Do not leave this unaddressed. Reach out immediately — your presence can make a critical difference.",
        ],
    },
}


# =============================================================================
# INFERENCE
# =============================================================================
_model_cache = None

def load_model():
    global _model_cache
    if _model_cache is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"Sentiment model not found at {MODEL_PATH}. "
                "Run: python regression/sentiment_model.py"
            )
        with open(MODEL_PATH, 'rb') as f:
            _model_cache = pickle.load(f)
    return _model_cache


def predict_sentiment(mood, notes, mood_streak=0, hour=12):
    model     = load_model()
    has_notes = bool(notes and notes.strip())
    vec       = build_feature_vector(mood, notes, mood_streak, hour).reshape(1, -1)

    label = int(model.predict(vec)[0])
    probs = model.predict_proba(vec)[0]   # [p0, p1, p2, p3]

    # Concern score: weighted sum of class centres
    centres    = np.array([15, 43, 65, 88])
    base_score = float(np.dot(probs, centres))

    # Crisis phrase bump
    text_feats = extract_text_features(notes)
    if text_feats.get('has_crisis') and has_notes:
        base_score = min(100, base_score + 20)
        label      = max(label, 3)

    # No notes — slight confidence reduction
    if not has_notes:
        base_score = base_score * 0.85

    score = round(min(100, max(0, base_score)), 1)
    meta  = LABEL_META[label]

    # Build reasons
    reasons = []
    mood_score_val = MOOD_SCORES.get(mood.lower(), 0.5)
    if mood_score_val <= 0.2:
        reasons.append(f"Selected mood '{mood}' indicates emotional difficulty")
    if has_notes and text_feats['negative_word_count'] > 0.15:
        reasons.append("Note contains multiple words associated with distress")
    if has_notes and text_feats['text_polarity'] < -0.3:
        reasons.append("Negative tone detected in the written note")
    if text_feats.get('has_crisis'):
        reasons.append("Crisis-level language detected in the note")
    if mood_streak >= 3:
        reasons.append(f"{mood_streak} consecutive concerning mood check-ins")
    if hour <= 5 or hour >= 22:
        reasons.append("Check-in at an unusual hour (late night / early morning)")
    if not reasons:
        reasons.append("Mood and note content analysed — no specific red flags")

    advice_list = meta['advice']
    advice      = advice_list[mood_streak % len(advice_list)]

    return {
        'sentiment_label': meta['label'],
        'sentiment_emoji': meta['emoji'],
        'sentiment_color': meta['color'],
        'concern_score':   score,
        'label_index':     label,
        'probabilities': {
            'positive':   round(float(probs[0]), 3),
            'neutral':    round(float(probs[1]), 3),
            'concerning': round(float(probs[2]), 3),
            'critical':   round(float(probs[3]), 3),
        },
        'reasons':        reasons,
        'advice':         advice,
        'should_alert':   meta['alert'],
        'alert_priority': meta['priority'],
        'has_notes':      has_notes,
        'mood_streak':    mood_streak,
        'mood_input':     mood,
        'notes_input':    notes or '',
    }


if __name__ == '__main__':
    train_and_save()

    print("\n-- Smoke test --")
    tests = [
        ('happy',   'Feeling great today! Went for a walk.',        0, 10),
        ('neutral', '',                                              0, 12),
        ('sad',     'Feeling very sad. Miss my family.',             2, 20),
        ('lonely',  'I feel like nobody cares. I want to give up.',  5,  2),
        ('anxious', 'Very worried about my health.',                 1, 14),
        ('tired',   '',                                              0, 15),
        ('sad',     '',                                              6,  3),
    ]
    for mood, notes, streak, hour in tests:
        r = predict_sentiment(mood, notes, streak, hour)
        print(f"  [{mood:8s}] streak={streak} hour={hour:02d}  -> "
              f"{r['sentiment_emoji']} {r['sentiment_label']:12s}  "
              f"score={r['concern_score']:5.1f}  "
              f"alert={'YES' if r['should_alert'] else 'no '}")