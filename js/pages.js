
(function(){
const STORE={settings:'retina_ai_settings',limits:'retina_ai_limits',sessions:'retina_ai_sessions',snapshot:'retina_ai_live_snapshot'};
const plans={posture:'Postür',catcow:'Kedi-İnek',birddog:'Kuş-Köpek',doorway:'Eşik Esneme',plank:'Plank',bridge:'Köprü'};
function read(k,f){try{const r=localStorage.getItem(k);return r?JSON.parse(r):f}catch(e){return f}}
function write(k,v){localStorage.setItem(k,JSON.stringify(v))}
function fmt(ms){const s=Math.floor((ms||0)/1000);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
function date(ts){return new Intl.DateTimeFormat('tr-TR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(ts||Date.now()))}
function sessions(){return read(STORE.sessions,[])}
function latest(){return read(STORE.snapshot,null)||sessions()[0]||null}
function advice(error){const t=(error||'').toLowerCase(); if(t.includes('baş')||t.includes('boyun'))return ['Chin tuck: 2 set x 10','Göğüs açma: 2 x 30 sn','Ekranı göz hizasına al']; if(t.includes('omuz'))return ['Wall angel: 2 x 8','Scapular retraction: 2 x 12','Omuzları kulaktan uzaklaştır']; if(t.includes('omurga')||t.includes('kambur')||t.includes('sırt'))return ['Thoracic extension: 2 x 45 sn','Cat-cow: 2 x 10','Göğüs açma + sırt aktivasyonu']; if(t.includes('kalça')||t.includes('bel'))return ['Glute bridge: 3 x 12','Dead bug: 2 x 8','Hip flexor stretch: 2 x 30 sn']; return ['Günlük 10 dk analiz','Haftada 3 gün plank + bridge','Aynı kamera mesafesiyle ölçüm'];}

function exportPDF(snapshot){
  const s = snapshot || latest();
  if(!s){ alert('Henüz raporlanacak seans yok.'); return; }
  const { jsPDF } = window.jspdf || {};
  if(!jsPDF){ alert('PDF kütüphanesi yüklenemedi. İnternet bağlantısını kontrol edin.'); return; }

  const pdf = new jsPDF({ unit:'mm', format:'a4', compress:true });
  const pageW = 210, pageH = 297;
  const canvasPDF = document.createElement('canvas');
  canvasPDF.width = 1240;
  canvasPDF.height = 1754;
  const c = canvasPDF.getContext('2d');

  const W = canvasPDF.width, H = canvasPDF.height;
  const margin = 72;
  const contentW = W - margin * 2;
  let y = 0;

  c.fillStyle = '#f8fafc';
  c.fillRect(0,0,W,H);

  function setFont(size, weight='500'){
    c.font = `${weight} ${size}px Inter, Arial, Helvetica, sans-serif`;
    c.textBaseline = 'top';
  }
  function wrapText(text, maxWidth, size=28, weight='500'){
    const value = String(text || '');
    setFont(size, weight);
    const words = value.split(/\s+/);
    const lines = [];
    let current = '';
    words.forEach(word => {
      const test = current ? `${current} ${word}` : word;
      if(!current || c.measureText(test).width <= maxWidth) current = test;
      else { lines.push(current); current = word; }
    });
    if(current) lines.push(current);
    return lines;
  }
  function drawText(text, x, yy, size=28, color='#283144', weight='500', maxWidth=contentW, lineHeight=1.35){
    const lines = wrapText(text, maxWidth, size, weight);
    setFont(size, weight);
    c.fillStyle = color;
    const lineH = size * lineHeight;
    lines.forEach((lineText, index) => c.fillText(lineText, x, yy + index * lineH));
    return yy + Math.max(1, lines.length) * lineH;
  }
  function line(text, size=28, color='#283144', weight='500', gap=18, maxWidth=contentW, lineHeight=1.35){
    y = drawText(text, margin, y, size, color, weight, maxWidth, lineHeight);
    y += gap;
  }
  function roundRect(x, yy, w, h, r){
    c.beginPath();
    c.moveTo(x + r, yy); c.lineTo(x + w - r, yy); c.quadraticCurveTo(x + w, yy, x + w, yy + r);
    c.lineTo(x + w, yy + h - r); c.quadraticCurveTo(x + w, yy + h, x + w - r, yy + h);
    c.lineTo(x + r, yy + h); c.quadraticCurveTo(x, yy + h, x, yy + h - r);
    c.lineTo(x, yy + r); c.quadraticCurveTo(x, yy, x + r, yy); c.closePath();
  }
  function card(x, yy, w, h, label, value, accent){
    c.fillStyle = '#ffffff';
    roundRect(x, yy, w, h, 24); c.fill();
    c.strokeStyle = '#dbe3ef'; c.lineWidth = 2; c.stroke();
    drawText(label, x + 26, yy + 18, 26, '#64748b', '800', w - 52, 1.15);
    drawText(value, x + 26, yy + 64, 44, accent || '#0f172a', '900', w - 52, 1.1);
  }

  c.fillStyle = '#020617';
  c.fillRect(0,0,W,260);
  drawText('RETINA AI', margin, 52, 78, '#00f2fe', '900', contentW, 1.02);
  drawText('Smart Coach Postür ve Egzersiz Raporu', margin, 142, 34, '#f8fafc', '800', contentW, 1.15);
  drawText(date(s.savedAt), margin, 192, 24, '#cbd5e1', '500', contentW, 1.15);

  y = 310;
  const gap = 26;
  const cardW = Math.floor((contentW - gap * 2) / 3);
  const cardH = 150;
  const scoreColor = s.score >= 80 ? '#008c5a' : s.score >= 55 ? '#b46900' : '#d23728';
  card(margin, y, cardW, cardH, 'GENEL SKOR', `${s.score || 0}/100`, scoreColor);
  card(margin + cardW + gap, y, cardW, cardH, 'DOĞRU FORM', fmt(s.totalGood), '#008c5a');
  card(margin + (cardW + gap) * 2, y, cardW, cardH, 'HATALI FORM', fmt(s.totalBad), '#d23728');
  y += cardH + 54;

  line(`Toplam süre: ${fmt(s.totalTime)} | İhlal: ${s.breaks || 0}`, 32, '#0f172a', '800', 24);
  line(`Aktif mod: ${plans[s.activeMode] || s.activeMode || 'Postür'} | Postür tipi: ${s.postureType === 'standing' ? 'Ayakta' : 'Oturarak'}`, 30, '#283144', '500', 18, contentW, 1.28);
  line(`En sık hata: ${s.topError || 'Hata kaydı yok'}${s.topErrorCount ? ' (' + s.topErrorCount + ' kez)' : ''}`, 30, '#283144', '500', 24, contentW, 1.28);

  y += 8;
  line('Mod Bazlı Sonuçlar', 40, '#0f172a', '900', 14);
  Object.entries(s.modes || {}).forEach(([key, d]) => {
    line(`• ${plans[key] || key}: skor ${d.score || 0}/100, doğru ${fmt(d.good)}, hatalı ${fmt(d.bad)}, ihlal ${d.breaks || 0}`, 24, '#334155', '500', 10, contentW, 1.25);
  });

  y += 10;
  line('Kişisel Öneriler', 40, '#0f172a', '900', 14);
  advice(s.topError).forEach((a, i) => line(`${i+1}. ${a}`, 24, '#334155', '500', 10, contentW, 1.28));

  const footerY = H - 96;
  c.strokeStyle = '#dbe3ef'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(margin, footerY); c.lineTo(W - margin, footerY); c.stroke();
  drawText('Not: Bu uygulama tıbbi tanı koymaz; yalnızca kamera temelli form geri bildirimi sağlar.', margin, footerY + 18, 18, '#64748b', '500', contentW, 1.28);

  const img = canvasPDF.toDataURL('image/png');
  pdf.addImage(img, 'PNG', 0, 0, pageW, pageH, undefined, 'FAST');
  pdf.save(`retina-ai-rapor-${new Date().toISOString().slice(0,10)}.pdf`);
}

window.RetinaPages={STORE,plans,read,write,fmt,date,sessions,latest,advice,exportPDF};
})();
