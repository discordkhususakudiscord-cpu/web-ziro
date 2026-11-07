// ZIOX LINK - app.js
// OTAK WEB - ngatur semua yang bisa diklik

const serverUrl = 'https://ziox-link.vercel.app'; // ganti kalau pakai Railway

function toast(msg){
  const t = document.getElementById('toast');
  if(!t) { alert(msg); return; }
  t.textContent = msg; t.style.display='block';
  setTimeout(()=> t.style.display='none', 2000);
}

async function pasteInput(id){
  try{
    const text = await navigator.clipboard.readText();
    document.getElementById(id).value = text;
    toast('Ditempel!');
  }catch{ toast('Gagal paste, tempel manual aja'); }
}

function setStep(n){
  document.querySelectorAll('.steps div').forEach((el,i)=>{
    el.classList.toggle('active', i < n);
  });
}

async function bypassSFL(){
  const input = document.getElementById('sflInput');
  const url = input.value.trim();
  if(!url.includes('sfl.gl')){ toast('Link harus https://sfl.gl/xxx'); return; }
  const btn = document.getElementById('bypassBtn');
  btn.disabled = true; btn.textContent = 'Memproses...';
  const texts = ['01 Memvalidasi link...','02 Menghubungkan ke server...','03 Nembak ke SFL.gl...','04 Mengekstrak link asli...','05 Berhasil!'];
  for(let i=1;i<=5;i++){
    setStep(i);
    document.getElementById('statusText').textContent = texts[i-1];
    await new Promise(r=>setTimeout(r,500));
    if(i===3){
      try{
        const res = await fetch(serverUrl + '/bypass', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({url})
        });
        const data = await res.json();
        if(!data.success) throw new Error(data.error);
        document.getElementById('resultBox').classList.add('show');
        document.getElementById('resultLink').textContent = data.asli;
        document.getElementById('resultLink').href = data.asli;
        document.getElementById('resultFrom').textContent = 'Dari ' + url;
        let h = JSON.parse(localStorage.getItem('ziox_history')||'[]');
        h.unshift({sfl:url, asli:data.asli});
        localStorage.setItem('ziox_history', JSON.stringify(h));
        toast('Berhasil di-bypass!');
      }catch(e){ toast('Eror: '+e.message); }
      break;
    }
  }
  btn.disabled = false; btn.textContent = 'Bypass';
}

function copyResult(){
  navigator.clipboard.writeText(document.getElementById('resultLink').textContent);
  toast('Link asli disalin!');
}
function openResult(){
  window.open(document.getElementById('resultLink').textContent, '_blank');
}

function switchTab(tab){
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.style.display='none');
  document.getElementById('tab-'+tab).style.display='block';
  event.target.classList.add('active');
}
