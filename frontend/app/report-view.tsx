"use client";

// The report is untrusted page content. No scripts, forms, network requests or
// same-origin access are enabled inside this isolated frame.
export default function ReportView({ html }: { html: string }) {
  const document = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>body{margin:0;padding:24px;font:15px/1.7 Arial,sans-serif;background:white;color:#203b34}*{box-sizing:border-box}table{border-collapse:collapse;max-width:100%}img,svg{max-width:100%}h1,h2,h3{line-height:1.35}pre{white-space:pre-wrap}a{pointer-events:none}</style></head><body>${html}</body></html>`;
  return <iframe className="rich-report" title="Báo cáo phân tích với bảng và biểu đồ" sandbox="" referrerPolicy="no-referrer" srcDoc={document}/>;
}
