import { parseJson, sanitizeCss, sanitizeHtml } from './utils.js';
import { LOGO_DATA_URI } from './brand-logo-data.js';

const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function variables(document, signatory) {
  return {
    recipient_name: esc(document.recipient_name), designation: esc(document.designation || ''),
    date: esc(new Date(`${document.letter_date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })),
    document_number: esc(document.document_number || 'Assigned on finalisation'), signatory_name: esc(signatory.name),
    signatory_designation: esc(signatory.designation)
  };
}

export function substitute(source, vars) {
  return String(source || '').replace(/{{\s*([a-z_]+)\s*}}/gi, (_, key) => vars[key] ?? '');
}

export function renderDocument(document, template, signatory) {
  const v = variables(document, signatory);
  const m = { top:38,right:22,bottom:30,left:22,...parseJson(template.margins_json,{}) };
  const content = substitute(sanitizeHtml(document.content_html), v);
  const subject = document.subject ? `<div class="subject">Subject: ${esc(document.subject)}</div>` : '';
  const withBrandLogo = (source) => substitute(sanitizeHtml(source), v).replace('<b>LABDOX</b>', `<span class="brand-lockup"><img class="brand-logo" src="${LOGO_DATA_URI}" alt="Labdox logo"><b>LABDOX</b></span>`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;color:#172b4d;font:11.5pt/1.58 Arial,sans-serif}
    #source,#parts{display:none}.sheet{position:relative;width:210mm;height:297mm;break-after:page;background:#fff}
    .page-header{position:absolute;left:${Number(m.left)}mm;right:${Number(m.right)}mm;top:12mm;height:${Math.max(18,Number(m.top)-14)}mm}
    .page-footer{position:absolute;left:${Number(m.left)}mm;right:${Number(m.right)}mm;bottom:8mm;height:${Math.max(12,Number(m.bottom)-10)}mm;color:#637083;font-size:8.5pt}
    .page-flow{overflow-wrap:anywhere;position:absolute;left:${Number(m.left)}mm;right:${Number(m.right)}mm;top:${Number(m.top)}mm;bottom:${Number(m.bottom)}mm;overflow:visible}
    .meta{display:flex;justify-content:space-between;margin:0 0 6mm;font-size:9.5pt;color:#52606d}.subject{font-weight:700;margin:0 0 5mm}
    p{margin:0 0 3.5mm}ul,ol{margin:0 0 3.5mm;padding-left:7mm}.signature{break-inside:avoid;margin-top:12mm}.signature .line{width:52mm;border-top:1px solid #718096;margin:14mm 0 2mm}
    .footer{display:flex;justify-content:space-between;border-top:1px solid #d7dee7;padding-top:3mm}.mini-brand{font-size:9pt;font-weight:700;letter-spacing:1px;color:#0f766e}a{color:#0f766e}
    .brand-lockup{display:inline-flex;align-items:center;gap:3mm}.brand-logo{display:block;width:12mm;height:12mm;border-radius:2.5mm;object-fit:cover}.brand-lockup b{font-size:20pt;letter-spacing:2.5pt}
    img{max-width:100%;object-fit:contain}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccd5df;padding:2mm}li{margin-bottom:2mm}.page-number{position:absolute;bottom:3mm;right:22mm;font-size:8pt;color:#637083}.sheet:last-child{break-after:auto}#render-error{color:#b91c1c;padding:12mm}body[data-render-error] .sheet{display:none}
    ${sanitizeCss(template.css)}
  </style></head><body><div id="parts"><div id="header-first">${withBrandLogo(template.header_html)}</div><div id="footer-first">${substitute(sanitizeHtml(template.footer_html),v)}</div><div id="header-next">${withBrandLogo(template.continuation_header_html||template.header_html)}</div><div id="footer-next">${substitute(sanitizeHtml(template.continuation_footer_html||template.footer_html),v)}</div></div>
    <main id="source"><div class="meta"><span>${v.document_number}</span><span>${v.date}</span></div>${subject}<div class="letter-content">${content}</div><section class="signature"><div class="line"></div><strong>${v.signatory_name}</strong><br>${v.signatory_designation}</section></main><div id="pages"></div>
    <script>
      (async()=>{
        try {
          await document.fonts.ready;
          await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})));
          const parts=document.querySelector('#parts'),source=document.querySelector('#source'),pages=document.querySelector('#pages');
          const makePage=()=>{const continued=pages.children.length>0;const page=document.createElement('section');page.className='sheet';page.innerHTML='<header class="page-header"></header><div class="page-flow"></div><footer class="page-footer"></footer><div class="page-number"></div>';page.querySelector('.page-header').innerHTML=parts.querySelector(continued?'#header-next':'#header-first').innerHTML;page.querySelector('.page-footer').innerHTML=parts.querySelector(continued?'#footer-next':'#footer-first').innerHTML;pages.append(page);return page.querySelector('.page-flow')};
          let flow=makePage();
          const fits=()=>flow.scrollHeight<=flow.clientHeight+1;
          // Slice the DOM with Range instead of flattening it to text. Inline markup survives page breaks.
          function splitAt(node,count){
            const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text,remaining=count;
            while(text=walker.nextNode()){if(remaining<=text.length)break;remaining-=text.length;}
            if(!text)return [node.cloneNode(true),node.cloneNode(false)];
            const before=document.createRange();before.selectNodeContents(node);before.setEnd(text,remaining);
            const after=document.createRange();after.selectNodeContents(node);after.setStart(text,remaining);
            const a=node.cloneNode(false),b=node.cloneNode(false);a.append(before.cloneContents());b.append(after.cloneContents());
            if(node.tagName==='OL'){const start=Number(node.getAttribute('start')||1);const completed=a.querySelectorAll(':scope > li').length;const last=a.lastElementChild;const continuation=last && b.firstElementChild && last.textContent.length && b.firstElementChild.textContent.length; b.start=start+completed-(continuation?1:0);}
            return [a,b];
          }
          function place(block){
            flow.append(block);if(fits())return;block.remove();
            if(flow.children.length){const previous=flow;flow=makePage();flow.append(block);if(fits())return;block.remove();flow.parentElement.remove();flow=previous;}
            let iterations=0;
            while(block.textContent.length){
              if(++iterations>100)throw Error('Document exceeds 100 pages or contains unsupported oversized content.');
              let low=0,high=block.textContent.length;
              while(low<high){const mid=Math.ceil((low+high)/2),part=splitAt(block,mid)[0];flow.append(part);const ok=fits();part.remove();if(ok)low=mid;else high=mid-1;}
              if(!low){if(flow.children.length){flow=makePage();continue;}throw Error('A block cannot fit within the template margins. Reduce its size.');}
              if(low<block.textContent.length){const word=block.textContent.lastIndexOf(' ',low);if(word>low*0.65)low=word+1;}
              const [part,rest]=splitAt(block,low);if(rest.textContent.length>=block.textContent.length)throw Error('Unable to split this content safely.');flow.append(part);block=rest;
              if(block.textContent.length){flow=makePage();flow.append(block);if(fits())return;block.remove();}
            }
            if(block.querySelector('img,table') || block.tagName==='IMG')throw Error('An image or table exceeds the available page space. Reduce its size.');
          }
          const blocks=[];for(const el of source.children){if(el.classList.contains('letter-content')){for(const node of el.childNodes){if(node.nodeType===3){if(!node.textContent.trim())continue;const p=document.createElement('p');p.textContent=node.textContent;blocks.push(p)}else if(node.nodeType===1)blocks.push(node.cloneNode(true))}}else blocks.push(el.cloneNode(true));}
          blocks.forEach(place);
          const sheets=[...pages.children];sheets.forEach((page,i)=>{page.querySelector('.page-number').textContent='Page '+(i+1)+' of '+sheets.length;for(const selector of ['.page-header','.page-footer']){const region=page.querySelector(selector);if(region.scrollHeight>region.clientHeight+2)throw Error('Header or footer does not fit. Adjust the template margins or content.');}});
          document.body.dataset.renderReady='true';
          parent.postMessage({type:'labdox-render',pages:sheets.length,height:pages.scrollHeight},'*');
        }catch(error){document.body.dataset.renderError=error.message;const p=document.createElement('p');p.id='render-error';p.textContent=error.message;document.body.append(p);parent.postMessage({type:'labdox-render',error:error.message},'*');}
      })();
    </script>
  </body></html>`;
}

export function snapshot(document, template, signatory) {
  return { document: { ...document }, template: { ...template }, signatory: { ...signatory } };
}
