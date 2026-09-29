/** Saves text as a file through the browser's download mechanism. */
export function downloadText(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name that is safe on every platform. */
export const safeName = (s: string) => s.replace(/[^\w\-. ]+/g, '_').trim() || 'repertoire';
