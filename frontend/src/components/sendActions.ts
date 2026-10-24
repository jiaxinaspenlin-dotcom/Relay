// Copy / email / print helpers. Relay never sends on its own: these hand the text to the person.

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

export function mailtoUrl(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function openMail(subject: string, body: string): void {
  const a = document.createElement("a");
  a.href = mailtoUrl(subject, body);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Open the print window synchronously (so popup blockers allow it), then point it at the
 * fax-ready page once the send is recorded. */
export function openPrintWindow(): Window | null {
  return window.open("about:blank", "_blank");
}

export function printUrl(rid: string, commId: string): string {
  return `/print/${encodeURIComponent(rid)}/${encodeURIComponent(commId)}`;
}
