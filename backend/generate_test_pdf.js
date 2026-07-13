const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const doc = new PDFDocument();
const outputPath = path.join(__dirname, '../test_schedule.pdf');

doc.pipe(fs.createWriteStream(outputPath));

// Title
doc.fontSize(20).text('TSMC Hsinchu Fab 12', { align: 'center' });
doc.fontSize(14).text('Future Production Surplus Schedule', { align: 'center' }).moveDown(1.5);

doc.fontSize(11).text('The following list contains estimated byproduct and surplus outputs scheduled for pickup:');
doc.moveDown(1);

// Draw a table structure
doc.font('Courier');
doc.text('-------------------------------------------------------------');
doc.text('Scheduled Date | Material Type       | Surplus Quantity (kg) ');
doc.font('Courier-Bold');
doc.text('-------------------------------------------------------------');
doc.font('Courier');
doc.text('2026-08-25     | chemical_solvent    | 4500.00               ');
doc.text('2026-09-10     | metal_offcut        | 8200.00               ');
doc.text('2026-09-28     | plastic_offcut      | 3500.00               ');
doc.text('2026-10-12     | organic_sludge      | 6200.00               ');
doc.text('-------------------------------------------------------------');

doc.end();
console.log('PDF created successfully at: ' + outputPath);
