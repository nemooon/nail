export type MailBody = { text: string; html: string };

export function mailBodyText(body: MailBody) {
  if (body.text.trim()) return body.text;
  const doc = new DOMParser().parseFromString(body.html, 'text/html');
  doc.querySelectorAll('style, script, img').forEach(element => element.remove());
  doc.querySelectorAll('br').forEach(element => element.replaceWith('\n'));
  doc.querySelectorAll('p, div, tr, li').forEach(element => element.append('\n'));
  doc.querySelectorAll('td, th').forEach(element => element.append(' '));
  return doc.body.textContent ?? '';
}
