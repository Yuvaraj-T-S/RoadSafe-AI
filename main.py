from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import pandas as pd

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = joblib.load("roadsafe_model.joblib")

class PredictionRequest(BaseModel):
    road: str
    weather: str
    lighting: str
    roadCondition: str
    factor: str

@app.post("/predict")
def predict_risk(data: PredictionRequest):
    # The fields should match the categorical_features in train_model.py
    input_df = pd.DataFrame([data.model_dump()])
    predicted_score = model.predict(input_df)[0]
    return {
        "predicted_risk_score": round(float(predicted_score), 2)
    }
