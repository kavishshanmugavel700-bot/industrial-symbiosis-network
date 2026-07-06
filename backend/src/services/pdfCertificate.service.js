const PDFKit = require('pdfkit');
const crypto = require('crypto');

/**
 * Generates a carbon exchange certificate PDF as an in-memory Buffer.
 * Returns { buffer, certificateId } — caller is responsible for storing/serving it.
 */
function generateCertificatePdf({ matchId, sellerName, buyerName, materialType, quantityKg, co2AvoidedKg }) {
  return new Promise((resolve, reject) => {
    const certificateId = `ISN-${matchId}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const doc = new PDFKit({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), certificateId }));
    doc.on('error', reject);

    doc
      .fontSize(20)
      .text('Industrial Symbiosis Intelligence Network', { align: 'center' })
      .moveDown(0.3)
      .fontSize(14)
      .fillColor('#16a34a')
      .text('Verified Carbon Exchange Certificate', { align: 'center' })
      .fillColor('black')
      .moveDown(1.5);

    doc.fontSize(11);
    doc.text(`Certificate ID: ${certificateId}`);
    doc.text(`Match ID: ${matchId}`);
    doc.text(`Issued: ${new Date().toLocaleString()}`);
    doc.moveDown(1);

    doc.fontSize(13).text('Exchange Details', { underline: true });
    doc.fontSize(11).moveDown(0.5);
    doc.text(`Seller Factory: ${sellerName}`);
    doc.text(`Buyer Factory: ${buyerName}`);
    doc.text(`Material Type: ${materialType}`);
    doc.text(`Quantity: ${quantityKg} kg`);
    doc.moveDown(1);

    doc.fontSize(13).text('Verified Impact', { underline: true });
    doc.fontSize(11).moveDown(0.5);
    doc.fillColor('#16a34a').fontSize(16).text(`${co2AvoidedKg} kg CO2e avoided`);
    doc.fillColor('black').fontSize(11);
    doc.moveDown(1);

    doc.fontSize(9).fillColor('#666').text(
      'Emission factors sourced from Taiwan EPA (climate.moenv.gov.tw). ' +
        'This certificate is auto-generated and contributes to Taiwan NDC 3.0 reporting.',
      { align: 'left' }
    );

    doc.end();
  });
}

module.exports = { generateCertificatePdf };
