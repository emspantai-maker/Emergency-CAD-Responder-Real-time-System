// --- URL API ของ Google Apps Script ---
const API_URL = 'https://script.google.com/macros/s/AKfycbxxP56X0yKvreK4akH_ayEo0b0QZYa5DYdpPblr1zd7A0Pqwn6GTJpN6r302KrEYAAp/exec';

let currentUser = JSON.parse(localStorage.getItem('ems_user')) || null;
let pollInterval = null;
let currentCaseId = null;

// เมื่อหน้าเว็บโหลด
document.addEventListener('DOMContentLoaded', () => {
    if (currentUser) {
        showApp();
    }
});

// UI Toggles
function toggleRegister() {
    document.getElementById('login-form').classList.toggle('hidden');
    document.getElementById('register-form').classList.toggle('hidden');
}

// Helper Function สำหรับยิง API
// Trick: GAS รองรับ POST JSON ได้ แต่ต้องตั้ง Content-Type เป็น text/plain เพื่อเลี่ยง CORS Preflight Options
async function callAPI(method, payload = null, action = '') {
    const url = method === 'GET' ? `${API_URL}?action=${action}${payload ? '&'+new URLSearchParams(payload) : ''}` : API_URL;
    const options = {
        method: method,
        redirect: "follow"
    };
    
    if (method === 'POST') {
        options.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
        options.body = JSON.stringify(payload);
    }

    const response = await fetch(url, options);
    return await response.json();
}

// --- Auth Systems ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.innerText = 'กำลังเข้าสู่ระบบ...';
    btn.disabled = true;

    const payload = {
        action: 'login',
        username: e.target.username.value,
        password: e.target.password.value
    };

    const res = await callAPI('POST', payload);
    btn.innerText = 'เข้าสู่ระบบ';
    btn.disabled = false;

    if (res.status === 'success') {
        currentUser = res.data;
        localStorage.setItem('ems_user', JSON.stringify(currentUser));
        showApp();
    } else {
        alert(res.message);
    }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        action: 'register',
        name: document.getElementById('reg-name').value,
        username: document.getElementById('reg-username').value,
        password: document.getElementById('reg-password').value,
        role: document.getElementById('reg-role').value
    };

    const res = await callAPI('POST', payload);
    alert(res.message);
    if(res.status === 'success') toggleRegister();
});

function logout() {
    localStorage.removeItem('ems_user');
    currentUser = null;
    if(pollInterval) clearInterval(pollInterval);
    location.reload();
}

// --- Routing & Role Management ---
function showApp() {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('user-info').classList.remove('hidden');
    document.getElementById('display-name').innerText = `สวัสดี, ${currentUser.Name} (${currentUser.Role})`;

    if (currentUser.Role === 'Dispatcher') {
        document.getElementById('dispatcher-section').classList.remove('hidden');
        loadDispatcherData();
        // Dispatcher อาจจะ Refresh ข้อมูลทุกๆ 30 วินาที
        pollInterval = setInterval(loadDispatcherData, 30000);
    } else if (currentUser.Role === 'Responder') {
        document.getElementById('responder-section').classList.remove('hidden');
        checkMyCase();
        // Polling สำหรับ Responder เช็คเคสใหม่ทุกๆ 10 วินาที
        pollInterval = setInterval(checkMyCase, 10000);
    }
}

// --- Dispatcher Functions ---
document.getElementById('create-case-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        action: 'createCase',
        callerName: document.getElementById('case-caller').value,
        phone: document.getElementById('case-phone').value,
        location: document.getElementById('case-location').value,
        description: document.getElementById('case-desc').value,
        severity: document.getElementById('case-severity').value
    };

    const res = await callAPI('POST', payload);
    alert(res.message);
    e.target.reset();
    loadDispatcherData();
});

async function loadDispatcherData() {
    // ดึงข้อมูล Users และ Cases มาพร้อมกัน
    const [usersRes, casesRes] = await Promise.all([
        callAPI('GET', null, 'getUsers'),
        callAPI('GET', null, 'getCases')
    ]);

    const responders = usersRes.data || [];
    const cases = casesRes.data || [];
    const container = document.getElementById('case-list-container');
    container.innerHTML = '';

    const activeCases = cases.filter(c => c.Status !== 'Completed').reverse();

    if (activeCases.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-4">ไม่มีเคสค้างในระบบ</p>';
        return;
    }

    activeCases.forEach(c => {
        const severityColor = c.Severity === 'High' ? 'bg-red-100 text-red-800' : 
                              (c.Severity === 'Medium' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800');
        
        let responderOptions = `<option value="">-- เลือกทีม --</option>`;
        responders.forEach(r => {
            responderOptions += `<option value="${r.Username}" ${c.AssignedTo === r.Username ? 'selected' : ''}>${r.Name}</option>`;
        });

        const card = document.createElement('div');
        card.className = 'border p-3 rounded bg-gray-50 fade-in';
        card.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <span class="text-xs font-bold px-2 py-1 rounded ${severityColor}">${c.Severity}</span>
                <span class="text-xs font-bold text-gray-500">${c.Status}</span>
            </div>
            <p class="font-bold">${c.Location}</p>
            <p class="text-sm text-gray-600">${c.Description}</p>
            <div class="mt-3 flex gap-2">
                <select class="w-full text-sm p-1 border rounded" id="assign-${c.CaseID}">
                    ${responderOptions}
                </select>
                <button onclick="assignCase('${c.CaseID}')" class="bg-blue-600 text-white text-sm px-3 py-1 rounded hover:bg-blue-700">สั่งการ</button>
            </div>
        `;
        container.appendChild(card);
    });
}

async function assignCase(caseId) {
    const assignedTo = document.getElementById(`assign-${caseId}`).value;
    if(!assignedTo) return alert('กรุณาเลือกทีมผู้ปฏิบัติการ');

    const res = await callAPI('POST', { action: 'assignCase', caseId, assignedTo });
    if(res.status === 'success') {
        alert('มอบหมายงานสำเร็จ!');
        loadDispatcherData();
    }
}

// --- Responder Functions ---
async function checkMyCase() {
    const res = await callAPI('GET', { username: currentUser.Username }, 'checkMyCase');
    const myCase = res.data;
    
    const noCaseView = document.getElementById('no-case');
    const activeCaseView = document.getElementById('active-case');
    const alertSound = document.getElementById('alert-sound');

    if (myCase) {
        // เจอเคสใหม่ (และยังไม่ใช่เคสเดิมที่กำลังเปิดอยู่) แจ้งเตือนเสียง!
        if (currentCaseId !== myCase.CaseID && myCase.Status === 'New') {
            alertSound.play().catch(e => console.log('Audio autoplay blocked by browser'));
            // สั่นมือถือ (ถ้าเบราว์เซอร์และเครื่องรองรับ)
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]); 
        }
        
        currentCaseId = myCase.CaseID;
        noCaseView.classList.add('hidden');
        activeCaseView.classList.remove('hidden');

        document.getElementById('r-case-id').innerText = myCase.CaseID;
        document.getElementById('r-case-location').innerText = myCase.Location;
        document.getElementById('r-case-desc').innerText = myCase.Description;
        document.getElementById('r-case-caller').innerText = `ผู้แจ้ง: ${myCase.CallerName}`;
        
        const phoneLink = document.getElementById('r-case-phone');
        phoneLink.innerText = myCase.Phone;
        phoneLink.href = `tel:${myCase.Phone}`;
    } else {
        currentCaseId = null;
        noCaseView.classList.remove('hidden');
        activeCaseView.classList.add('hidden');
    }
}

async function updateStatus(newStatus) {
    if(!currentCaseId) return;
    
    const res = await callAPI('POST', { 
        action: 'updateStatus', 
        caseId: currentCaseId, 
        newStatus: newStatus 
    });

    if (res.status === 'success') {
        if(newStatus === 'Completed') {
            alert('ปิดเคสเรียบร้อย ยอดเยี่ยมมาก!');
            checkMyCase(); // จะทำให้กลับไปหน้าสแตนด์บาย
        } else {
            alert(`อัปเดตสถานะเป็น: ${newStatus}`);
        }
    }
}
