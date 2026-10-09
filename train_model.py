import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.metrics import mean_squared_error, r2_score
import joblib

# 1. Load dataset
df = pd.read_csv("accidents.csv")

# 2. Define Features (X) and Target (y)
# Target: Calculate a risk score (0-100) based on fatalities and injuries
df['target_risk'] = (df['fatalities'] * 40 + df['injuries'] * 15 + 10).clip(0, 100)

features = ['road', 'weather', 'lighting', 'roadCondition', 'factor']
X = df[features]
y = df['target_risk']

# 3. Preprocessing & Train-Test Split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

categorical_features = ['road', 'weather', 'lighting', 'roadCondition', 'factor']
preprocessor = ColumnTransformer(
    transformers=[
        ('cat', OneHotEncoder(handle_unknown='ignore'), categorical_features)
    ]
)

# 4. Define and Train Pipeline
model_pipeline = Pipeline(steps=[
    ('preprocessor', preprocessor),
    ('regressor', RandomForestRegressor(n_estimators=100, random_state=42))
])

print("Training model...")
model_pipeline.fit(X_train, y_train)

# 5. Evaluate Model
y_pred = model_pipeline.predict(X_test)
print(f"Model Trained Successfully!")
print(f"R2 Score: {r2_score(y_test, y_pred):.2f}")
print(f"RMSE: {np.sqrt(mean_squared_error(y_test, y_pred)):.2f}")

# 6. Export Model
joblib.dump(model_pipeline, "roadsafe_model.joblib")
print("Saved trained model to 'roadsafe_model.joblib'")
