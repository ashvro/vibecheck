"""
VibeCheck dropout-risk model — training & export.

Faithful reproduction of ml_analysis_full.py (Documents/ML), plus a JSON
export so the Express backend can run inference with zero Python at runtime.

The label-generation stage is byte-for-byte the original:
    risk_score = (100 - attendance)/100 * 0.35
               + (1 - sentiment) * 0.25
               + (10 - cgpa)/10 * 0.40
    risk_score += N(0, 0.05)                  # irreducible label noise
    Low  <= q33 | Medium <= q66 | High        # quantile buckets

Re-run with:  python3 train_model.py
Output:       model.json  (+ reference_predictions.json for the JS port test)
"""

import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score

SEED = 42
TEST_SIZE = 0.25

LABEL_WEIGHTS = {"attendance": 0.35, "sentiment": 0.25, "marks": 0.40}
Q_LOW, Q_MEDIUM = 0.33, 0.66

FEATURES = ["sentimentscore", "attendance_percent", "marks_cgpa"]
CLASS_ORDER = ["Low", "Medium", "High"]

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_INPUT = os.path.join(HERE, "student_data_with_dropout_risk.csv")
INPUT = os.environ.get("ML_INPUT_CSV", DEFAULT_INPUT)


def build_labels(df):
    """Original label stage. Returns (labels, noisy_risk_score, q1, q2)."""
    risk = (
        (100 - df["attendance_percent"]) / 100 * LABEL_WEIGHTS["attendance"]
        + (1 - df["sentimentscore"]) * LABEL_WEIGHTS["sentiment"]
        + (10 - df["marks_cgpa"]) / 10 * LABEL_WEIGHTS["marks"]
    )
    # Same seed, same draw order as the original script.
    rng = np.random.RandomState(SEED)
    risk = risk + rng.normal(0, 0.05, size=len(df))

    q1, q2 = risk.quantile([Q_LOW, Q_MEDIUM])

    def bucket(x):
        if x <= q1:
            return "Low"
        if x <= q2:
            return "Medium"
        return "High"

    return risk.apply(bucket), risk, float(q1), float(q2)


def main():
    df = pd.read_csv(INPUT)

    np.random.seed(SEED)
    labels, noisy_risk, q1, q2 = build_labels(df)

    # Verify the reproduction against the labels shipped with the dataset.
    if "dropout_risk" in df.columns:
        agreement = float((labels.values == df["dropout_risk"].values).mean())
        print(f"label reproduction agreement: {agreement * 100:.2f}%")
        if agreement < 0.99:
            raise SystemExit(
                f"label pipeline drift: {agreement * 100:.2f}% agreement — refusing to export"
            )

    X = df[FEATURES]
    y = labels

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=SEED, stratify=y
    )

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    X_train_s = pd.DataFrame(X_train_s, columns=X.columns)
    X_test_s = pd.DataFrame(X_test_s, columns=X.columns)

    # Primary model: ties for best accuracy in the original study (86.84%).
    # Chosen for portability — a linear model maps exactly onto JS arithmetic.
    clf = LogisticRegression(max_iter=1000)
    clf.fit(X_train_s, y_train)

    test_acc = accuracy_score(y_test, clf.predict(X_test_s))
    full_acc = accuracy_score(y, clf.predict(scaler.transform(X)))
    print(f"Logistic Regression  test acc: {test_acc * 100:.2f}%  |  full-data acc: {full_acc * 100:.2f}%")

    model = {
        "name": "Logistic Regression",
        "type": "logistic_regression",
        "featureOrder": FEATURES,
        "classes": list(clf.classes_),
        "scaler": {
            "mean": [float(v) for v in scaler.mean_],
            "scale": [float(v) for v in scaler.scale_],
        },
        "coef": [[float(v) for v in row] for row in clf.coef_],
        "intercept": [float(v) for v in clf.intercept_],
        "accuracyTest": round(float(test_acc) * 100, 2),
        "accuracyFull": round(float(full_acc) * 100, 2),
    }

    artifact = {
        "version": "1.0.0",
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "ml_analysis_full.py (Documents/ML)",
        "seed": SEED,
        "testSize": TEST_SIZE,
        "features": FEATURES,
        "labelWeights": LABEL_WEIGHTS,
        "labelNoise": {"distribution": "normal", "mean": 0.0, "stdDev": 0.05},
        "thresholds": {
            "quantiles": [Q_LOW, Q_MEDIUM],
            "q1": q1,
            "q2": q2,
        },
        "classOrder": CLASS_ORDER,
        "primaryModel": model,
        "dataset": {
            "rows": int(len(df)),
            "trainRows": int(len(X_train)),
            "testRows": int(len(X_test)),
            "classDistribution": {k: int(v) for k, v in y.value_counts().items()},
        },
    }

    with open(os.path.join(HERE, "model.json"), "w") as fh:
        json.dump(artifact, fh, indent=2)
    print("wrote model.json")

    # Reference predictions so the JS port can be diffed against Python.
    preds = clf.predict(scaler.transform(X))
    reference = {
        "note": "Python LogisticRegression output for every dataset row. The JS port must match exactly.",
        "rows": [
            {
                "username": str(u),
                "sentimentscore": float(s),
                "attendance_percent": float(a),
                "marks_cgpa": float(c),
                "expected": str(p),
                "expectedScore": round(float(noisy_risk.iloc[i]) * 100, 4),
            }
            for i, (u, s, a, c, p) in enumerate(
                zip(df["username"], X["sentimentscore"], X["attendance_percent"], X["marks_cgpa"], preds)
            )
        ],
    }
    with open(os.path.join(HERE, "reference_predictions.json"), "w") as fh:
        json.dump(reference, fh, indent=2)
    print(f"wrote reference_predictions.json ({len(reference['rows'])} rows)")

    # The original study's full 8-model table, carried over for display.
    study = pd.read_csv(os.path.join(os.path.dirname(INPUT), "model_accuracy_results.csv"))
    artifact["studyResults"] = [
        {"model": str(r["Model"]), "accuracy": float(r["Accuracy (%)"])} for _, r in study.iterrows()
    ]
    with open(os.path.join(HERE, "model.json"), "w") as fh:
        json.dump(artifact, fh, indent=2)
    print("embedded study results table into model.json")


if __name__ == "__main__":
    main()
