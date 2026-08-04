import { useState } from 'react';

export function useDownloadWorkbook() {
  const [progress, setProgress] = useState(null); // null means idle, number is percentage
  const [error, setError] = useState('');

  const download = async (colId) => {
    try {
      setProgress(0);
      const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken');
      const res = await fetch(`/api/collections/${colId}/download`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error('Download failed');
      
      const contentLength = res.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      
      const disp = res.headers.get('Content-Disposition');
      let filename = `workbook.xlsx`;
      if (disp && disp.includes('filename="')) {
        filename = disp.split('filename="')[1].split('"')[0];
      }
      
      const reader = res.body.getReader();
      let receivedLength = 0;
      const chunks = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        
        if (total) {
          setProgress(Math.round((receivedLength / total) * 100));
        } else {
          // Fake progress if no content-length available
          setProgress((prev) => Math.min((prev || 0) + 10, 95));
        }
      }
      
      const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      
      // Briefly show 100% before resetting
      setTimeout(() => setProgress(null), 800);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to download workbook.');
      setProgress(null);
      setTimeout(() => setError(''), 4000);
    }
  };

  return { download, progress, error, setError };
}
