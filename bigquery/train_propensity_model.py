#!/usr/bin/env python3
"""
Vertex AI Propensity Scoring Model
Trains a model to predict clinic conversion likelihood
Uses BigQuery ML for simplicity (no separate Vertex AI training job needed)
"""

from google.cloud import bigquery

PROJECT_ID = 'warp-486714'
DATASET = 'novalyte_intelligence'
MODEL_NAME = 'clinic_propensity_model'

client = bigquery.Client(project=PROJECT_ID)

def train_model():
    """Train logistic regression model using BigQuery ML"""
    print("🤖 Training clinic propensity model...")
    
    query = f"""
    CREATE OR REPLACE MODEL `{PROJECT_ID}.{DATASET}.{MODEL_NAME}`
    OPTIONS(
      model_type='LOGISTIC_REG',
      input_label_cols=['label'],
      auto_class_weights=TRUE,
      max_iterations=50
    ) AS
    SELECT
      type,
      rating,
      review_count,
      affluence_score,
      median_income,
      market_population,
      service_count,
      outreach_count,
      response_count,
      calls_count,
      emails_sent,
      emails_opened,
      email_open_rate,
      response_rate,
      label
    FROM `{PROJECT_ID}.{DATASET}.clinic_conversion_training`
    WHERE label IS NOT NULL;
    """
    
    job = client.query(query)
    job.result()  # Wait for completion
    print("✅ Model trained successfully")

def evaluate_model():
    """Evaluate model performance"""
    print("📊 Evaluating model...")
    
    query = f"""
    SELECT
      *
    FROM ML.EVALUATE(MODEL `{PROJECT_ID}.{DATASET}.{MODEL_NAME}`);
    """
    
    results = client.query(query).result()
    for row in results:
        print(f"  Precision: {row.precision:.3f}")
        print(f"  Recall: {row.recall:.3f}")
        print(f"  Accuracy: {row.accuracy:.3f}")
        print(f"  F1 Score: {row.f1_score:.3f}")
        print(f"  AUC: {row.roc_auc:.3f}")

def score_all_clinics():
    """Score all clinics and update propensity_score column"""
    print("🎯 Scoring all clinics...")
    
    query = f"""
    UPDATE `{PROJECT_ID}.{DATASET}.clinics` c
    SET
      propensity_score = p.predicted_label_probs[OFFSET(1)].prob,
      propensity_tier = CASE
        WHEN p.predicted_label_probs[OFFSET(1)].prob >= 0.7 THEN 'hot'
        WHEN p.predicted_label_probs[OFFSET(1)].prob >= 0.4 THEN 'warm'
        ELSE 'cold'
      END,
      last_scored_at = CURRENT_TIMESTAMP()
    FROM (
      SELECT
        clinic_id,
        predicted_label_probs
      FROM ML.PREDICT(MODEL `{PROJECT_ID}.{DATASET}.{MODEL_NAME}`, (
        SELECT
          clinic_id,
          type,
          rating,
          review_count,
          affluence_score,
          median_income,
          market_population,
          ARRAY_LENGTH(services) as service_count,
          outreach_count,
          response_count,
          calls_count,
          emails_sent,
          emails_opened,
          CASE WHEN emails_sent > 0 THEN emails_opened / emails_sent ELSE 0 END as email_open_rate,
          CASE WHEN outreach_count > 0 THEN response_count / outreach_count ELSE 0 END as response_rate
        FROM `{PROJECT_ID}.{DATASET}.clinics`
        WHERE NOT converted  -- Only score unconverted clinics
      ))
    ) p
    WHERE c.clinic_id = p.clinic_id;
    """
    
    job = client.query(query)
    job.result()
    print("✅ All clinics scored")

def get_top_prospects(limit=50):
    """Get top prospects for outreach"""
    print(f"\n🔥 Top {limit} prospects:")
    
    query = f"""
    SELECT
      clinic_id,
      name,
      city,
      state,
      phone,
      email,
      propensity_score,
      propensity_tier,
      affluence_score,
      services
    FROM `{PROJECT_ID}.{DATASET}.clinics`
    WHERE propensity_tier IN ('hot', 'warm')
      AND NOT converted
      AND (last_outreach_date IS NULL OR last_outreach_date < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY))
    ORDER BY propensity_score DESC
    LIMIT {limit};
    """
    
    results = client.query(query).result()
    for i, row in enumerate(results, 1):
        print(f"{i}. {row.name} ({row.city}, {row.state}) - Score: {row.propensity_score:.2f} ({row.propensity_tier})")
        if row.phone:
            print(f"   📞 {row.phone}")
        if row.email:
            print(f"   📧 {row.email}")

def main():
    print("🚀 Novalyte Clinic Propensity Scoring Pipeline\n")
    
    try:
        train_model()
        evaluate_model()
        score_all_clinics()
        get_top_prospects(50)
        
        print("\n✅ Pipeline complete!")
        print("💡 Next: Export top prospects and load into Voice Agent for calls")
    except Exception as e:
        print(f"❌ Error: {e}")
        raise

if __name__ == '__main__':
    main()
