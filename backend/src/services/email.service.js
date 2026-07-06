const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: env.gmailUser,
        pass: env.gmailAppPassword,
      },
    });
  }
  return transporter;
}

async function sendMail({ to, subject, html, attachments }) {
  if (!env.gmailUser || !env.gmailAppPassword) {
    console.warn('[email] GMAIL_USER/GMAIL_APP_PASSWORD not set — skipping send, logging instead.');
    console.log(`[email:skip] to=${to} subject=${subject}`);
    return { skipped: true };
  }
  const info = await getTransporter().sendMail({
    from: `"Industrial Symbiosis Network" <${env.gmailUser}>`,
    to,
    subject,
    html,
    attachments,
  });
  return info;
}

async function sendSurplusAlert({ buyerEmail, listing, matchId, acceptUrl, declineUrl }) {
  const html = `
    <h2>Predicted Surplus Alert</h2>
    <p>A factory is predicted to have surplus <strong>${listing.material_type}</strong>
    (~${listing.quantity_kg} kg) available around
    ${listing.predicted_surplus_date ? new Date(listing.predicted_surplus_date).toLocaleString() : 'soon'}.</p>
    <p>Factory: ${listing.factory_name}</p>
    <p>
      <a href="${acceptUrl}" style="padding:8px 16px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;">Accept</a>
      &nbsp;
      <a href="${declineUrl}" style="padding:8px 16px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;">Decline</a>
    </p>
    <p style="color:#666;font-size:12px;">Match ID: ${matchId}</p>
  `;
  return sendMail({
    to: buyerEmail,
    subject: `Surplus Alert: ${listing.material_type} available soon`,
    html,
  });
}

async function sendCertificateEmail({ to, pdfBuffer, filename }) {
  return sendMail({
    to,
    subject: 'Your Carbon Exchange Certificate',
    html: `<p>Attached is your verified carbon exchange certificate. Thank you for participating in the circular economy!</p>`,
    attachments: pdfBuffer
      ? [{ filename, content: pdfBuffer }]
      : [],
  });
}

module.exports = { sendMail, sendSurplusAlert, sendCertificateEmail };
