/**
 * Lead Referral Service
 * Generates and sends clinic referral emails containing the full patient assessment package.
 */
import axios from 'axios';
import { PatientLead, getTreatmentLabel, getQuestionnaireForLead, NearbyClinic } from './patientLeadService';

const RESEND_BASE = 'https://api.resend.com';
const FROM_ADDRESS = 'Novalyte <outreach@novalyte.io>';
const RESEND_KEY = (import.meta as any).env?.VITE_RESEND_API_KEY || '';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function generateReferralEmailHTML(lead: PatientLead, clinic: NearbyClinic): string {
  const treatmentLabel = getTreatmentLabel(lead.treatment);
  const qa = getQuestionnaireForLead(lead);
  const score = lead.match_score ?? 0;
  const scoreColor = score >= 80 ? '#10B981' : score >= 60 ? '#06B6D4' : '#F59E0B';
  const date = new Date(lead.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const qaRows = qa.map(item => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px;width:40%;">${esc(item.question)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-size:13px;font-weight:500;">${esc(item.answer)}</td>
    </tr>
  `).join('');

  const aiSummary = lead.analysis_result?.summary || lead.analysis_result?.recommendation || '';
  const recommendation = lead.analysis_result?.recommendation || '';
  const biomarkers = (lead.analysis_result?.biomarkers || []) as Array<{ name: string; relevance: string; expectedAction: string }>;

  const biomarkersHTML = biomarkers.length > 0 ? `
    <div style="margin-top:20px;">
      <p style="font-size:13px;font-weight:600;color:#1a1a1a;margin:0 0 10px;">Recommended Biomarkers</p>
      ${biomarkers.map(b => `
        <div style="background:#f8f9fa;border-radius:6px;padding:10px;margin-bottom:6px;border-left:3px solid #06B6D4;">
          <span style="font-weight:600;color:#1a1a1a;font-size:12px;">${esc(b.name)}</span>
          <span style="color:#666;font-size:12px;"> — ${esc(b.relevance)}</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Patient Referral</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0B1120,#111B2E);border-radius:16px 16px 0 0;padding:28px;text-align:center;">
          <table role="presentation" cellspacing="0" cellpadding="0" align="center">
            <tr>
              <td style="width:36px;height:36px;background:#0B1120;border:1px solid #1C2B42;border-radius:8px;text-align:center;line-height:36px;color:#06B6D4;font-weight:800;font-size:16px;">N</td>
              <td style="padding-left:10px;font-size:18px;font-weight:700;color:white;">Novalyte AI</td>
            </tr>
          </table>
          <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:12px 0 0;">Pre-Qualified Patient Referral</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:white;padding:28px;border:1px solid #e5e5e5;border-top:none;">

          <!-- Intro -->
          <p style="font-size:15px;color:#1a1a1a;line-height:1.6;margin:0 0 16px;">
            Hello,<br><br>
            We're referring a <strong>pre-qualified patient</strong> who completed our AI health assessment and is seeking <strong>${esc(treatmentLabel)}</strong> services in your area. Below is their complete assessment package.
          </p>

          <!-- Score + Contact Card -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px;">
            <tr>
              <td style="width:100px;background:#fafafa;border:1px solid #eee;border-radius:12px 0 0 12px;padding:20px;text-align:center;vertical-align:top;">
                <p style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">Score</p>
                <p style="font-size:36px;font-weight:800;color:${scoreColor};margin:0;">${score}%</p>
              </td>
              <td style="background:#fafafa;border:1px solid #eee;border-left:none;border-radius:0 12px 12px 0;padding:20px;vertical-align:top;">
                <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 8px;">${esc(lead.name || 'Patient')}</p>
                <p style="font-size:13px;color:#666;margin:0 0 4px;">📧 <a href="mailto:${esc(lead.email)}" style="color:#06B6D4;text-decoration:none;">${esc(lead.email)}</a></p>
                <p style="font-size:13px;color:#666;margin:0 0 4px;">📱 <a href="tel:${esc(lead.phone)}" style="color:#06B6D4;text-decoration:none;">${esc(lead.phone)}</a></p>
                <p style="font-size:13px;color:#666;margin:0;">📍 ${esc(lead.zip_code)} · Assessed ${date}</p>
              </td>
            </tr>
          </table>

          <!-- Treatment + Eligibility -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:20px;">
            <tr>
              <td width="50%" style="padding-right:8px;">
                <div style="background:#06B6D410;border:1px solid #06B6D430;border-radius:8px;padding:12px;text-align:center;">
                  <p style="font-size:10px;color:#06B6D4;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Treatment</p>
                  <p style="font-size:14px;font-weight:600;color:#1a1a1a;margin:0;">${esc(treatmentLabel)}</p>
                </div>
              </td>
              <td width="50%" style="padding-left:8px;">
                <div style="background:${lead.eligibility_status === 'qualified' ? '#10B98110' : '#F59E0B10'};border:1px solid ${lead.eligibility_status === 'qualified' ? '#10B98130' : '#F59E0B30'};border-radius:8px;padding:12px;text-align:center;">
                  <p style="font-size:10px;color:${lead.eligibility_status === 'qualified' ? '#10B981' : '#F59E0B'};text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Status</p>
                  <p style="font-size:14px;font-weight:600;color:#1a1a1a;margin:0;">${lead.eligibility_status === 'qualified' ? '✅ Pre-Qualified' : '⚠️ Pending Review'}</p>
                </div>
              </td>
            </tr>
          </table>

          <!-- Full Questionnaire -->
          <p style="font-size:14px;font-weight:600;color:#1a1a1a;margin:0 0 10px;border-bottom:2px solid #06B6D4;padding-bottom:6px;">Assessment Questionnaire</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px;border:1px solid #eee;border-radius:8px;overflow:hidden;">
            <tr style="background:#fafafa;">
              <td style="padding:8px 12px;font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:0.5px;">Question</td>
              <td style="padding:8px 12px;font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:0.5px;">Patient Response</td>
            </tr>
            ${qaRows}
          </table>

          ${aiSummary ? `
          <!-- AI Analysis -->
          <div style="background:#f0f7ff;border:1px solid #d0e3ff;border-radius:8px;padding:16px;margin-bottom:20px;">
            <p style="font-size:12px;font-weight:600;color:#2563EB;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">🧠 AI Analysis Summary</p>
            <p style="font-size:13px;color:#1a1a1a;line-height:1.6;margin:0;">${esc(aiSummary)}</p>
            ${recommendation && recommendation !== aiSummary ? `<p style="font-size:13px;color:#1a1a1a;line-height:1.6;margin:8px 0 0;"><strong>Recommendation:</strong> ${esc(recommendation)}</p>` : ''}
            ${lead.urgency ? `<p style="font-size:12px;color:#666;margin:8px 0 0;">Urgency: <strong>${esc(lead.urgency)}</strong></p>` : ''}
          </div>
          ` : ''}

          ${biomarkersHTML}

          <!-- CTA -->
          <div style="background:linear-gradient(135deg,#06B6D410,#06B6D405);border:1px solid #06B6D430;border-radius:12px;padding:20px;text-align:center;margin-top:24px;">
            <p style="font-size:13px;color:#666;margin:0 0 12px;">This patient is ready for a consultation. Please reach out within 24 hours.</p>
            <table role="presentation" cellspacing="0" cellpadding="0" align="center">
              <tr>
                <td style="padding-right:8px;">
                  <a href="tel:${esc(lead.phone)}" style="display:inline-block;background:#10B981;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">📞 Call Patient</a>
                </td>
                <td style="padding-left:8px;">
                  <a href="mailto:${esc(lead.email)}" style="display:inline-block;background:#06B6D4;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">📧 Email Patient</a>
                </td>
              </tr>
            </table>
          </div>

        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px;text-align:center;border-radius:0 0 16px 16px;">
          <p style="font-size:11px;color:#999;margin:0;">Sent via Novalyte AI Patient Intelligence Platform · novalyte.io</p>
          <p style="font-size:10px;color:#ccc;margin:4px 0 0;">This referral contains confidential patient information. Handle in accordance with HIPAA guidelines.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function generateReferralSubject(lead: PatientLead): string {
  const treatmentLabel = getTreatmentLabel(lead.treatment);
  const score = lead.match_score ?? 0;
  return `Pre-Qualified Patient Referral: ${lead.name} — ${treatmentLabel} (${score}% Match)`;
}

export async function sendReferralEmail(
  lead: PatientLead,
  clinic: NearbyClinic,
  toEmail: string
): Promise<{ success: boolean; error?: string }> {
  if (!RESEND_KEY) return { success: false, error: 'Resend API key not configured' };

  const html = generateReferralEmailHTML(lead, clinic);
  const subject = generateReferralSubject(lead);

  try {
    const { data } = await axios.post(
      `${RESEND_BASE}/emails`,
      {
        from: FROM_ADDRESS,
        to: [toEmail],
        subject,
        html,
        tags: [
          { name: 'type', value: 'patient_referral' },
          { name: 'treatment', value: lead.treatment },
          { name: 'clinic', value: clinic.name.slice(0, 256) },
          { name: 'lead_id', value: lead.id },
        ],
      },
      { headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' } }
    );
    return { success: true };
  } catch (err: any) {
    const msg = err?.response?.data?.message || err.message || 'Unknown error';
    console.error('Referral email failed:', msg);
    return { success: false, error: msg };
  }
}
