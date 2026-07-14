/**
 * pdfUpload.js
 * Handles the production schedule PDF upload widget on the factory profile page.
 * Only shows the widget to users with 'factory' or 'admin' role.
 */
document.addEventListener('DOMContentLoaded', () => {
  const user = auth.getUser();
  if (!user || (user.role !== 'factory' && user.role !== 'buyer' && user.role !== 'admin')) return;

  // Show the card
  const card = document.getElementById('pdf-upload-card');
  if (card) card.style.display = 'block';

  const fileInput    = document.getElementById('pdf-file-input');
  const dropZone     = document.getElementById('pdf-drop-zone');
  const fileNameEl   = document.getElementById('pdf-file-name');
  const uploadBtn    = document.getElementById('pdf-upload-btn');
  const resultEl     = document.getElementById('pdf-upload-result');

  let selectedFile = null;

  // File selected via input
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      selectFile(fileInput.files[0]);
    }
  });

  // Drag & drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--clr-primary)';
    dropZone.style.background  = 'var(--clr-primary-glow)';
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'var(--clr-border)';
    dropZone.style.background  = '';
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--clr-border)';
    dropZone.style.background  = '';
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      selectFile(file);
    } else {
      notifications.showError('Please drop a PDF file.');
    }
  });

  function selectFile(file) {
    selectedFile = file;
    fileNameEl.textContent = `📄 ${file.name}`;
    fileNameEl.style.display = 'block';
    uploadBtn.disabled = false;
    resultEl.style.display = 'none';
  }

  // Upload button
  uploadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    uploadBtn.disabled = true;
    uploadBtn.textContent = '⏳ Uploading & Extracting...';
    resultEl.style.display = 'none';

    const factory = auth.getFactory();
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const token    = localStorage.getItem('isin_token');
      const response = await fetch(`${API_BASE_URL}/api/listings/upload-schedule`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      resultEl.style.display = 'block';
      resultEl.innerHTML = `
        <div style="background: hsla(142, 68%, 45%, 0.08); border: 1px solid hsla(142, 68%, 45%, 0.3); border-radius: var(--radius-md); padding: 1rem;">
          <p style="font-weight: 700; color: var(--clr-success); margin-bottom: 0.4rem;">✅ Schedule uploaded!</p>
          <p style="font-size: 0.85rem; color: var(--clr-text-muted);">
            <strong>${data.pdfRowCount}</strong> rows extracted from PDF &nbsp;+&nbsp;
            <strong>${data.predictedRowsAdded}</strong> AI-forecast slots added.
          </p>
        </div>
      `;
      notifications.showSuccess(`Schedule processed! ${data.pdfRowCount} confirmed + ${data.predictedRowsAdded} AI slots.`);
    } catch (err) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = `
        <div style="background: hsla(0, 70%, 50%, 0.08); border: 1px solid hsla(0, 70%, 50%, 0.3); border-radius: var(--radius-md); padding: 1rem;">
          <p style="font-weight: 700; color: var(--clr-error);">Upload failed</p>
          <p style="font-size: 0.85rem; color: var(--clr-text-muted);">${err.message}</p>
        </div>
      `;
      notifications.showError(err.message || 'Failed to upload schedule.');
    } finally {
      uploadBtn.disabled  = false;
      uploadBtn.textContent = 'Upload & Extract Schedule';
    }
  });
});
