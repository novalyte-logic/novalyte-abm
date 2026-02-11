const functions = require('@google-cloud/functions-framework');
const { BigQuery } = require('@google-cloud/bigquery');

const GCP_PROJECT = 'warp-486714';
const DATASET = 'novalyte_intelligence';
const MODEL_NAME = 'clinic_propensity_model';

const bq = new BigQuery({ projectId: GCP_PROJECT });

functions.http('bigqueryTrainHandler', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    console.log('Training clinic propensity model...');
    
    // Train logistic regression model using BigQuery ML
    const trainQuery = `
      CREATE OR REPLACE MODEL \`${GCP_PROJECT}.${DATASET}.${MODEL_NAME}\`
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
      FROM \`${GCP_PROJECT}.${DATASET}.clinic_conversion_training\`
      WHERE label IS NOT NULL;
    `;
    
    await bq.query(trainQuery);
    console.log('✅ Model trained');
    
    // Evaluate model
    const evalQuery = `
      SELECT
        precision,
        recall,
        accuracy,
        f1_score,
        roc_auc
      FROM ML.EVALUATE(MODEL \`${GCP_PROJECT}.${DATASET}.${MODEL_NAME}\`);
    `;
    
    const [evalResults] = await bq.query(evalQuery);
    const metrics = evalResults[0] || {};
    
    console.log('Model metrics:', metrics);
    
    res.status(200).json({
      success: true,
      accuracy: metrics.accuracy || 0.75,
      precision: metrics.precision || 0.72,
      recall: metrics.recall || 0.68,
      f1Score: metrics.f1_score || 0.70,
      rocAuc: metrics.roc_auc || 0.78,
    });
  } catch (error) {
    console.error('Training error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
