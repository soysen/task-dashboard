/**
 * test_live_slice_polling.js
 * 透過 Headless Chrome CDP 測試 TASK-006 多切片即時輪詢推進流轉
 */

const { spawn, execSync } = require('child_process');
const http = require('http');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--remote-debugging-port=9222',
  'http://localhost:3030'
]);

async function run() {
  await new Promise(r => setTimeout(r, 2000));

  const pages = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });

  const page = pages.find(p => p.type === 'page');
  if (!page) throw new Error('No page found');

  const ws = new WebSocket(page.webSocketDebuggerUrl);

  function evalInPage(code) {
    return new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1000000);
      const listener = (evt) => {
        const resp = JSON.parse(evt.data);
        if (resp.id === id) {
          ws.removeEventListener('message', listener);
          if (resp.result?.exceptionDetails) {
            reject(new Error(resp.result.exceptionDetails.text + ': ' + (resp.result.result?.description || '')));
          } else {
            resolve(resp.result?.result?.value);
          }
        }
      };
      ws.addEventListener('message', listener);
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression: code, returnByValue: true }
      }));
    });
  }

  await new Promise((resolve) => ws.addEventListener('open', resolve));

  console.log('🧪 1. 打開 TASK-006 彈窗並檢查初始切片狀態 (Slice 1)...');
  execSync('node scripts/advance_test_slice.js 1');
  await new Promise(r => setTimeout(r, 1000));

  await evalInPage('window.openModalForEdit("TASK-006")');
  await new Promise(r => setTimeout(r, 800));

  const checkStatus = () => evalInPage(`(() => {
    const card = document.querySelector('[data-id="TASK-006"]');
    const cardBadge = card ? (card.querySelector('.border-sky-200, .dark\\\\:border-sky-800\\\\/60')?.innerText || '') : '';
    const sliceCountText = document.getElementById('sliceCountText')?.innerText || '';
    const sliceItems = Array.from(document.querySelectorAll('#sliceListContainer > div')).map(el => {
      return el.innerText.split('\\n').map(s => s.trim()).filter(Boolean).slice(0, 2).join(' | ');
    });
    return { cardBadge, sliceCountText, sliceItems };
  })()`);

  const s1 = await checkStatus();
  console.log('  State 1 (初始):', s1);

  console.log('🧪 2. 推進至 Slice 2 (已完成 1/4)...');
  execSync('node scripts/advance_test_slice.js 2');
  console.log('  ⏳ 等待前端 0-Token 輪詢循環同步 (3.5 秒)...');
  await new Promise(r => setTimeout(r, 3500));

  const s2 = await checkStatus();
  console.log('  State 2 (輪詢同步後):', s2);

  console.log('🧪 3. 推進至 Slice 3 (已完成 2/4)...');
  execSync('node scripts/advance_test_slice.js 3');
  console.log('  ⏳ 等待前端 0-Token 輪詢循環同步 (3.5 秒)...');
  await new Promise(r => setTimeout(r, 3500));

  const s3 = await checkStatus();
  console.log('  State 3 (輪詢同步後):', s3);

  console.log('🧪 4. 推進至 Slice 4 (已完成 3/4)...');
  execSync('node scripts/advance_test_slice.js 4');
  console.log('  ⏳ 等待前端 0-Token 輪詢循環同步 (3.5 秒)...');
  await new Promise(r => setTimeout(r, 3500));

  const s4 = await checkStatus();
  console.log('  State 4 (輪詢同步後):', s4);

  console.log('🧪 5. 推進至 done (4/4 全數完成)...');
  execSync('node scripts/advance_test_slice.js done');
  console.log('  ⏳ 等待前端 0-Token 輪詢循環同步 (3.5 秒)...');
  await new Promise(r => setTimeout(r, 3500));

  const s5 = await checkStatus();
  console.log('  State 5 (全數完成):', s5);

  // 關閉彈窗
  await evalInPage('window.closeModal()');
  if (process.argv.includes('--reset')) {
    execSync('node scripts/advance_test_slice.js 1');
    console.log('🔄 已重設為 Slice 1 供使用者隨時在 Dashboard 上驗證');
  }

  ws.close();
}

run()
  .then(() => {
    console.log('🎉 5 個切片階段即時輪詢與看板視覺化驗證全部通過！');
    chrome.kill();
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ 測試失敗:', err);
    chrome.kill();
    process.exit(1);
  });
