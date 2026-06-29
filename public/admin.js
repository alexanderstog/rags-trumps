const screenLogin = document.getElementById('screen-login');
const screenManage = document.getElementById('screen-manage');
const passcodeInput = document.getElementById('passcodeInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

const adminAddForm = document.getElementById('adminAddForm');
const adminAddBtn = document.getElementById('adminAddBtn');
const adminList = document.getElementById('adminList');

let adminCategories = [];
let passcode = sessionStorage.getItem('ttg_admin_passcode') || '';

function authHeaders(extra = {}) {
  return { ...extra, 'x-admin-passcode': passcode };
}

async function tryUnlock(code) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: code })
  });
  return res.ok;
}

loginBtn.addEventListener('click', async () => {
  const code = passcodeInput.value;
  loginError.textContent = '';
  const ok = await tryUnlock(code);
  if (!ok) {
    loginError.textContent = 'Incorrect passcode.';
    return;
  }
  passcode = code;
  sessionStorage.setItem('ttg_admin_passcode', passcode);
  screenLogin.classList.add('hidden');
  screenManage.classList.remove('hidden');
  loadAdminPlayers();
});

passcodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

// ---------- Tabs ----------

document.querySelectorAll('.admin-tab').forEach(tabBtn => {
  tabBtn.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
    tabBtn.classList.add('active');
    document.getElementById('tab-players').classList.toggle('hidden', tabBtn.dataset.tab !== 'players');
    document.getElementById('tab-competitions').classList.toggle('hidden', tabBtn.dataset.tab !== 'competitions');
    if (tabBtn.dataset.tab === 'competitions') loadCompetitions();
  });
});

function buildStatInputs(prefix, existingStats = {}) {
  return adminCategories.map(cat => `
    <div class="admin-stat-input">
      <label>${cat.name}</label>
      <input type="number" data-cat="${cat.id}" id="${prefix}-cat-${cat.id}" value="${existingStats[cat.id] ?? ''}" />
    </div>
  `).join('');
}

async function loadAdminCategories() {
  const res = await fetch('/api/categories', { headers: authHeaders() });
  if (res.status === 401) return handleUnauthorized();
  adminCategories = await res.json();
}

function handleUnauthorized() {
  sessionStorage.removeItem('ttg_admin_passcode');
  passcode = '';
  screenManage.classList.add('hidden');
  screenLogin.classList.remove('hidden');
  loginError.textContent = 'Session expired — enter the passcode again.';
}

async function loadAdminPlayers() {
  await loadAdminCategories();
  if (!passcode) return;

  adminAddForm.innerHTML = `
    <label>Name</label>
    <input type="text" id="newPlayerName" placeholder="Player name" />
    ${buildStatInputs('new')}
  `;

  const res = await fetch('/api/players', { headers: authHeaders() });
  if (res.status === 401) return handleUnauthorized();
  const players = await res.json();
  adminList.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'admin-player';
    div.innerHTML = `
      <div class="admin-player-header">
        <input type="text" value="${p.name}" data-field="name" />
        <button class="small-btn danger" data-action="delete">Delete</button>
      </div>
      <div class="admin-photo-row">
        ${p.photo_url ? `<img class="admin-photo-preview" src="${p.photo_url}" alt="${p.name}" />` : '<span class="admin-photo-placeholder">🏌️</span>'}
        <input type="file" accept="image/*" data-field="photo" />
      </div>
      <p class="upload-status" data-field="uploadStatus"></p>
      <label>Ryder Cup Team</label>
      <select data-field="team">
        <option value="" ${!p.team ? 'selected' : ''}>None</option>
        <option value="usa" ${p.team === 'usa' ? 'selected' : ''}>🇺🇸 USA</option>
        <option value="europe" ${p.team === 'europe' ? 'selected' : ''}>🇪🇺 Europe</option>
      </select>
      <label class="exclude-toggle">
        <input type="checkbox" data-field="exclude" ${p.exclude_competitions ? 'checked' : ''} />
        Exclude from competitions (Stableford / Par 3 / Fantasy Golf)
      </label>
      ${buildStatInputs(`p${p.id}`, p.stats)}
      <button class="small-btn save" data-action="save">Save</button>
    `;
    div.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`Delete ${p.name}?`)) return;
      const r = await fetch(`/api/players/${p.id}`, { method: 'DELETE', headers: authHeaders() });
      if (r.status === 401) return handleUnauthorized();
      loadAdminPlayers();
    });
    div.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const name = div.querySelector('[data-field="name"]').value.trim();
      const exclude_competitions = div.querySelector('[data-field="exclude"]').checked;
      const team = div.querySelector('[data-field="team"]').value || null;
      const stats = {};
      adminCategories.forEach(cat => {
        const input = div.querySelector(`#p${p.id}-cat-${cat.id}`);
        stats[cat.id] = Number(input.value) || 0;
      });
      const r = await fetch(`/api/players/${p.id}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name, stats, exclude_competitions, team })
      });
      if (r.status === 401) return handleUnauthorized();
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        alert(`Could not save player: ${err.error || r.status}`);
        return;
      }
      loadAdminPlayers();
    });

    const photoInput = div.querySelector('[data-field="photo"]');
    const uploadStatus = div.querySelector('[data-field="uploadStatus"]');
    photoInput.addEventListener('change', () => {
      const file = photoInput.files[0];
      photoInput.value = '';
      if (!file) return;
      openCropper(file, async (blob) => {
        uploadStatus.textContent = 'Uploading...';
        uploadStatus.className = 'upload-status';
        const formData = new FormData();
        formData.append('photo', blob, 'cropped.jpg');
        try {
          const photoRes = await fetch(`/api/players/${p.id}/photo`, {
            method: 'POST',
            headers: authHeaders(),
            body: formData
          });
          if (photoRes.status === 401) return handleUnauthorized();
          if (!photoRes.ok) {
            const err = await photoRes.json().catch(() => ({}));
            uploadStatus.textContent = `Upload failed: ${err.error || photoRes.status}`;
            uploadStatus.className = 'upload-status err';
            return;
          }
          loadAdminPlayers();
        } catch (e) {
          uploadStatus.textContent = `Upload failed: ${e.message}`;
          uploadStatus.className = 'upload-status err';
        }
      });
    });
    adminList.appendChild(div);
  });
}

adminAddBtn.addEventListener('click', async () => {
  const name = document.getElementById('newPlayerName').value.trim();
  if (!name) return;
  const stats = {};
  adminCategories.forEach(cat => {
    const input = document.getElementById(`new-cat-${cat.id}`);
    stats[cat.id] = Number(input.value) || 0;
  });
  const r = await fetch('/api/players', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, stats })
  });
  if (r.status === 401) return handleUnauthorized();
  loadAdminPlayers();
});

// ---------- Competitions tab ----------

const compTable = document.getElementById('compTable');
const ryderEurope = document.getElementById('ryderEurope');
const ryderUsa = document.getElementById('ryderUsa');
const ryderCupStatus = document.getElementById('ryderCupStatus');

const COMP_LABELS = { stableford: 'Stableford', par3: 'Par 3', fantasy_golf: 'Fantasy Golf' };

async function loadCompetitions() {
  const res = await fetch('/api/admin/competitions', { headers: authHeaders() });
  if (res.status === 401) return handleUnauthorized();
  const data = await res.json();

  ryderEurope.value = data.ryderCup.europe;
  ryderUsa.value = data.ryderCup.usa;

  const head = `
    <thead>
      <tr>
        <th>Player</th>
        ${data.competitions.map(c => `<th>${COMP_LABELS[c] || c}</th>`).join('')}
      </tr>
    </thead>
  `;
  const body = `
    <tbody>
      ${data.players.map(p => `
        <tr>
          <td>${p.team === 'usa' ? '🇺🇸 ' : p.team === 'europe' ? '🇪🇺 ' : ''}${p.name}</td>
          ${data.competitions.map(c => `
            <td><input type="number" step="0.5" data-comp="${c}" data-player="${p.id}" value="${p.scores[c] ?? 0}" /></td>
          `).join('')}
        </tr>
      `).join('')}
    </tbody>
  `;
  const foot = `
    <tfoot>
      <tr>
        <td></td>
        ${data.competitions.map(c => `<td><button class="save-col-btn" data-save-comp="${c}">Save</button></td>`).join('')}
      </tr>
    </tfoot>
  `;
  compTable.innerHTML = head + body + foot;

  compTable.querySelectorAll('[data-save-comp]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const comp = btn.dataset.saveComp;
      const inputs = compTable.querySelectorAll(`input[data-comp="${comp}"]`);
      const compScores = {};
      inputs.forEach(input => { compScores[input.dataset.player] = Number(input.value) || 0; });
      btn.textContent = 'Saving...';
      const r = await fetch('/api/admin/competitions', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scores: { [comp]: compScores } })
      });
      if (r.status === 401) return handleUnauthorized();
      btn.textContent = r.ok ? 'Saved ✓' : 'Failed';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    });
  });
}

document.getElementById('saveRyderCupBtn').addEventListener('click', async () => {
  ryderCupStatus.textContent = 'Saving...';
  ryderCupStatus.className = 'upload-status';
  const r = await fetch('/api/admin/competitions', {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ryderCup: { europe: Number(ryderEurope.value) || 0, usa: Number(ryderUsa.value) || 0 } })
  });
  if (r.status === 401) return handleUnauthorized();
  if (!r.ok) {
    ryderCupStatus.textContent = 'Failed to save.';
    ryderCupStatus.className = 'upload-status err';
    return;
  }
  ryderCupStatus.textContent = 'Saved ✓';
  ryderCupStatus.className = 'upload-status ok';
});

// ---------- Photo cropper ----------

const cropModal = document.getElementById('cropModal');
const cropBox = document.getElementById('cropBox');
const cropImg = document.getElementById('cropImg');
const cropZoom = document.getElementById('cropZoom');
const cropSaveBtn = document.getElementById('cropSaveBtn');
const cropCancelBtn = document.getElementById('cropCancelBtn');
const cropError = document.getElementById('cropError');

const CROP_OUT_W = 640;
const CROP_OUT_H = 480;

let cropState = null; // { naturalW, naturalH, baseScale, zoom, offsetX, offsetY, onConfirm, objectUrl }

function cropBoxSize() {
  const rect = cropBox.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

function applyCropTransform() {
  const { naturalW, naturalH, zoom } = cropState;
  const { w: boxW, h: boxH } = cropBoxSize();
  const baseScale = Math.max(boxW / naturalW, boxH / naturalH);
  const scale = baseScale * zoom;
  const dispW = naturalW * scale;
  const dispH = naturalH * scale;

  cropState.scale = scale;
  cropState.dispW = dispW;
  cropState.dispH = dispH;
  cropState.offsetX = Math.min(0, Math.max(boxW - dispW, cropState.offsetX));
  cropState.offsetY = Math.min(0, Math.max(boxH - dispH, cropState.offsetY));

  cropImg.style.width = `${dispW}px`;
  cropImg.style.height = `${dispH}px`;
  cropImg.style.transform = `translate(${cropState.offsetX}px, ${cropState.offsetY}px)`;
}

function openCropper(file, onConfirm) {
  cropError.textContent = '';
  const objectUrl = URL.createObjectURL(file);
  cropImg.src = objectUrl;
  cropZoom.value = 1;

  cropImg.onload = () => {
    const naturalW = cropImg.naturalWidth;
    const naturalH = cropImg.naturalHeight;
    const { w: boxW, h: boxH } = cropBoxSize();
    const baseScale = Math.max(boxW / naturalW, boxH / naturalH);
    cropState = {
      naturalW,
      naturalH,
      zoom: 1,
      offsetX: (boxW - naturalW * baseScale) / 2,
      offsetY: (boxH - naturalH * baseScale) / 2,
      onConfirm,
      objectUrl
    };
    applyCropTransform();
    cropModal.classList.remove('hidden');
  };
  cropImg.onerror = () => {
    cropError.textContent = 'Could not read that file as an image.';
    cropModal.classList.remove('hidden');
  };
}

function closeCropper() {
  if (cropState?.objectUrl) URL.revokeObjectURL(cropState.objectUrl);
  cropState = null;
  cropModal.classList.add('hidden');
}

cropZoom.addEventListener('input', () => {
  if (!cropState) return;
  cropState.zoom = Number(cropZoom.value);
  applyCropTransform();
});

let dragStart = null;
function startDrag(x, y) {
  if (!cropState) return;
  dragStart = { x, y, offsetX: cropState.offsetX, offsetY: cropState.offsetY };
}
function moveDrag(x, y) {
  if (!dragStart || !cropState) return;
  cropState.offsetX = dragStart.offsetX + (x - dragStart.x);
  cropState.offsetY = dragStart.offsetY + (y - dragStart.y);
  applyCropTransform();
}
function endDrag() {
  dragStart = null;
}

cropBox.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
window.addEventListener('mouseup', endDrag);

cropBox.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  startDrag(t.clientX, t.clientY);
}, { passive: true });
cropBox.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  moveDrag(t.clientX, t.clientY);
}, { passive: true });
cropBox.addEventListener('touchend', endDrag);

cropCancelBtn.addEventListener('click', closeCropper);

cropSaveBtn.addEventListener('click', () => {
  if (!cropState) return;
  const { w: boxW, h: boxH } = cropBoxSize();
  const k = CROP_OUT_W / boxW;
  const canvas = document.createElement('canvas');
  canvas.width = CROP_OUT_W;
  canvas.height = CROP_OUT_H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    cropImg,
    0, 0, cropState.naturalW, cropState.naturalH,
    cropState.offsetX * k, cropState.offsetY * k, cropState.dispW * k, cropState.dispH * k
  );
  canvas.toBlob((blob) => {
    const onConfirm = cropState.onConfirm;
    closeCropper();
    if (blob) onConfirm(blob);
  }, 'image/jpeg', 0.9);
});

if (passcode) {
  tryUnlock(passcode).then((ok) => {
    if (ok) {
      screenLogin.classList.add('hidden');
      screenManage.classList.remove('hidden');
      loadAdminPlayers();
    } else {
      sessionStorage.removeItem('ttg_admin_passcode');
      passcode = '';
    }
  });
}
