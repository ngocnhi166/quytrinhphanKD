"use client";

// The report is untrusted page content. No scripts, forms, network requests or
// same-origin access are enabled inside this isolated frame.
// ChatGPT lets tables bleed to its window edges; clip that blank overflow at the body,
// while a frame narrower than the answer column still scrolls to reach all of it.
// When editable, the page needs same-origin access to switch the frame into design mode and read the
// edited report back; scripts inside it stay blocked by the sandbox and the CSP.
export default function ReportView({ html, editable, frameRef }: { html: string; editable?: boolean; frameRef?: React.Ref<HTMLIFrameElement> }) {
  const document = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>html{overflow:auto}body{margin:0;padding:24px;min-width:max-content;overflow-x:clip;font:15px/1.7 Arial,sans-serif;background:white;color:#203b34}*{box-sizing:border-box}table{border-collapse:collapse;max-width:100%}img,svg{max-width:100%}h1,h2,h3{line-height:1.35}pre{white-space:pre-wrap}a{pointer-events:none}</style></head><body>${html}</body></html>`;
  return <iframe ref={frameRef} className={editable ? "rich-report editing" : "rich-report"} title={editable ? "Chỉnh sửa báo cáo phân tích" : "Báo cáo phân tích với bảng và biểu đồ"}
    sandbox={editable ? "allow-same-origin" : ""} referrerPolicy="no-referrer" srcDoc={document}
    onLoad={editable ? e => { e.currentTarget.contentDocument!.designMode = "on"; } : undefined}/>;
}
