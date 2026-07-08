// Globals
const BACKEND_URL = "https://sc-dai-tu-dasboard-linehaul.vercel.app";
const GOOGLE_CLIENT_ID = "196922761837-1u6n4e7196jtt96n5revbgg7ag0386ud.apps.googleusercontent.com";

let rawData = [];
let filteredData = [];
let charts = {};

// Helper for XSS escaping
function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function showAuthError(msg) {
    const err = document.getElementById('auth-err');
    if (err) {
        err.textContent = msg;
        err.style.display = 'block';
    }
}

window.handleCredentialResponse = async function (response) {
    try {
        const res = await fetch(`${BACKEND_URL}/api/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ credential: response.credential })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            localStorage.setItem('ghn_user', data.email);
            localStorage.setItem('ghn_token', data.token);
            loginSuccess();
        } else {
            showAuthError(data.error || '❌ Đăng nhập thất bại. Vui lòng thử lại.');
            if (data.email) google.accounts.id.revoke(data.email, done => { });
        }
    } catch (e) {
        showAuthError('❌ Lỗi kết nối tới máy chủ.');
    }
};

function loginSuccess() {
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('loading').style.display = 'flex';
    loadData();
}

window.onload = function () {
    if (window.google) {
        try {
            google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleCredentialResponse
            });
            google.accounts.id.renderButton(
                document.getElementById("google-login-container"),
                { theme: "outline", size: "large", type: "standard", shape: "rectangular", text: "signin_with", logo_alignment: "left" }
            );
        } catch (e) {
            console.error(e);
        }
    }



    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        const token = localStorage.getItem('ghn_token');
        await fetch(`${BACKEND_URL}/api/logout`, { 
            method: 'POST', 
            headers: { 'Authorization': `Bearer ${token}` }
        });
        localStorage.removeItem('ghn_user');
        localStorage.removeItem('ghn_token');
        location.reload();
    });

    const user = localStorage.getItem('ghn_user');
    if (user && user.endsWith('@ghn.vn')) {
        loginSuccess();
    }

    initTabs();
    initFilters();
};

function initTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const pages = {
        'nav-overview': 'page-overview',
        'nav-charts': 'page-charts',
        'nav-production': 'page-production',
        'nav-alerts': 'page-alerts'
    };

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            Object.values(pages).forEach(p => {
                const el = document.getElementById(p);
                if (el) el.classList.add('hidden');
            });
            const target = document.getElementById(pages[item.id]);
            if (target) target.classList.remove('hidden');
        });
    });
}

function initFilters() {
    // Force clear browser cached values on load
    const resetIds = ['filter-stoppoint', 'filter-type', 'chart-filter-lane', 'chart-filter-stop', 'chart-filter-hour-from', 'chart-filter-hour-to', 'prod-day-filter'];
    resetIds.forEach(id => {
        if (document.getElementById(id)) document.getElementById(id).value = id.includes('hour-') ? "" : "ALL";
    });

    const startEl = document.getElementById('filter-start');
    const endEl = document.getElementById('filter-end');
    if (startEl && endEl) {
        const today = new Date();
        const lastWeek = new Date();
        lastWeek.setDate(today.getDate() - 7);
        startEl.valueAsDate = lastWeek;
        endEl.valueAsDate = today;
    }

    const triggerUpdateIds = ['filter-stoppoint', 'filter-type', 'filter-start', 'filter-end'];
    const triggerRenderIds = ['chart-filter-lane', 'chart-filter-stop', 'chart-filter-vehicle', 'chart-filter-hour-from', 'chart-filter-hour-to', 'prod-day-filter'];

    [...triggerUpdateIds, ...triggerRenderIds].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            if (triggerRenderIds.includes(id)) updateDashboard();
            else applyFilters();
        });
    });

    document.getElementById('reset-global-filters-btn')?.addEventListener('click', () => {
        if (document.getElementById('filter-stoppoint')) document.getElementById('filter-stoppoint').value = "ALL";
        if (document.getElementById('filter-type')) document.getElementById('filter-type').value = "ALL";
        if (document.getElementById('filter-start')) document.getElementById('filter-start').value = "";
        if (document.getElementById('filter-end')) document.getElementById('filter-end').value = "";
        applyFilters();
    });
}

async function loadData() {
    const token = localStorage.getItem('ghn_token');
    if (!token) {
        document.getElementById('loading').innerHTML = '❌ Phiên đăng nhập hết hạn. Vui lòng tải lại trang và đăng nhập lại.';
        return;
    }

    try {
        const response = await fetch(`${BACKEND_URL}/api/data`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Data fetch failed');
        
        const csvText = await response.text();
        
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: function (results) {
                processData(results.data);
                document.getElementById('loading').style.display = 'none';
            },
            error: function (error) {
                console.error('Lỗi khi tải dữ liệu:', error);
                document.getElementById('loading').innerHTML = '❌ Lỗi phân tích dữ liệu. Vui lòng tải lại trang.';
            }
        });
    } catch (error) {
        console.error('Lỗi khi tải dữ liệu:', error);
        document.getElementById('loading').innerHTML = '❌ Lỗi tải dữ liệu. Vui lòng kiểm tra lại quyền truy cập.';
    }
}

function processData(data) {
    rawData = data.map(row => {
        const dateStr = row.dt ? row.dt.substring(0, 10) : "";
        return {
            date: dateStr,
            hour: (row.gio_hieu_chinh || "").padStart(5, '0'),
            stoppoint: row.stoppoint_name || "Khác",
            type: row.phanloai || "Khác",
            weight: (parseFloat(row.tong_weight) || 0) / 1000000, // Grams to Tons
            capacity: (parseFloat(row.trong_tai) || 0), // Kg
            vehicle: row.BKS || "",
            partner: row.doi_tac || "Khác"
        };
    }).filter(row => row.date !== "");

    const stoppoints = [...new Set(rawData.map(d => d.stoppoint))].sort();
    const dates = [...new Set(rawData.map(d => d.date))].sort();
    const types = [...new Set(rawData.map(d => d.type))].sort();
    const vehicles = [...new Set(rawData.map(d => d.vehicle))].filter(v => v && v !== "0.00E+00").sort();

    const populate = (id, arr, allLabel) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = `<option value="ALL">${escapeHTML(allLabel)}</option>`;
        arr.forEach(a => el.innerHTML += `<option value="${escapeHTML(a)}">${escapeHTML(a)}</option>`);
    };

    populate('filter-stoppoint', stoppoints, 'Tất cả kho');
    populate('chart-filter-lane', stoppoints, 'Tất cả');
    populate('chart-filter-stop', stoppoints, 'Tất cả');
    populate('chart-filter-vehicle', vehicles, 'Tất cả');
    populate('prod-day-filter', dates, 'Tất cả ngày');
    populate('hourly-date', dates, 'Tất cả ngày');
    populate('veh-hour-day1', dates, 'Chọn ngày 1');
    populate('veh-hour-day2', dates, 'Chọn ngày 2');

    // Advanced hour dropdowns
    const hoursArr = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0') + ':00');
    populate('chart-filter-hour-from', hoursArr, '00h');
    populate('chart-filter-hour-to', hoursArr, '23h');

    applyFilters();
}

function applyFilters() {
    const stp = document.getElementById('filter-stoppoint')?.value || "ALL";
    const type = document.getElementById('filter-type')?.value || "ALL";
    const start = document.getElementById('filter-start')?.value || "";
    const end = document.getElementById('filter-end')?.value || "";

    filteredData = rawData.filter(d => {
        if (stp !== "ALL" && d.stoppoint !== stp) return false;
        if (type !== "ALL" && d.type !== type) return false;
        if (start && d.date < start) return false;
        if (end && d.date > end) return false;
        return true;
    });

    updateDashboard();
}

// Chart Helpers
function createChart(id, type, labels, datasets, options = {}) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();

    charts[id] = new Chart(ctx, {
        type: type,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#888' } },
                tooltip: { mode: 'index', intersect: false }
            },
            ...options
        }
    });
}

function updateDashboard() {
    // 1. KPIs
    const totalIn = filteredData.filter(d => d.type === "Nhập").length;
    const totalOut = filteredData.filter(d => d.type === "Xuất").length;

    if (document.getElementById('kpi-in')) document.getElementById('kpi-in').textContent = totalIn.toLocaleString('vi-VN');
    if (document.getElementById('kpi-out')) document.getElementById('kpi-out').textContent = totalOut.toLocaleString('vi-VN');

    // Total weight (already in tons)
    const weightIn = filteredData.filter(d => d.type === "Nhập").reduce((s, d) => s + d.weight, 0);
    const weightOut = filteredData.filter(d => d.type === "Xuất").reduce((s, d) => s + d.weight, 0);

    if (document.getElementById('kpi-peak')) document.getElementById('kpi-peak').textContent = Math.round(weightIn + weightOut).toLocaleString('vi-VN') + "t";
    if (document.getElementById('kpi-type')) document.getElementById('kpi-type').textContent = (totalIn + totalOut).toLocaleString('vi-VN');

    // Group by hour
    const hours = {};
    filteredData.forEach(d => {
        if (!hours[d.hour]) hours[d.hour] = { in: 0, out: 0 };
        if (d.type === "Nhập") hours[d.hour].in++;
        else hours[d.hour].out++;
    });
    const hourLabels = Object.keys(hours).sort();
    const hourInData = hourLabels.map(h => hours[h].in);
    const hourOutData = hourLabels.map(h => hours[h].out);

    createChart('hourlyChart', 'bar', hourLabels, [
        { label: 'Nhập', data: hourInData, backgroundColor: '#f26522' },
        { label: 'Xuất', data: hourOutData, backgroundColor: '#00467f' }
    ]);

    // Alerts Logic (Basic >30% calc)
    if (hourLabels.length > 0) {
        const avg = (totalIn + totalOut) / hourLabels.length;
        let spikeCount = 0;
        hourLabels.forEach(h => {
            if (hours[h].in + hours[h].out > avg * 1.3) spikeCount++;
        });
        if (document.getElementById('alert-hourly-count')) document.getElementById('alert-hourly-count').textContent = spikeCount.toLocaleString('vi-VN');
    }

    // 2. vehicleChart: Phân bố Trọng tải Xe
    const weightBuckets = { '< 1.5 tấn': 0, '1.5 - 3.5 tấn': 0, '3.5 - 7 tấn': 0, '> 7 tấn': 0 };
    filteredData.forEach(d => {
        if (d.capacity < 1500) weightBuckets['< 1.5 tấn']++;
        else if (d.capacity < 3500) weightBuckets['1.5 - 3.5 tấn']++;
        else if (d.capacity < 7000) weightBuckets['3.5 - 7 tấn']++;
        else weightBuckets['> 7 tấn']++;
    });
    createChart('vehicleChart', 'doughnut', Object.keys(weightBuckets), [{
        data: Object.values(weightBuckets),
        backgroundColor: ['#00cec9', '#6c5ce7', '#fdcb6e', '#ff7675']
    }]);

    // 3. dailyChart: Xu hướng Nhập / Xuất theo Ngày
    const dayStats = {};
    filteredData.forEach(d => {
        if (!dayStats[d.date]) dayStats[d.date] = { in: 0, out: 0, weight: 0, hours: {}, vehicles: {} };
        if (d.type === "Nhập") dayStats[d.date].in++;
        else dayStats[d.date].out++;
        dayStats[d.date].weight += d.weight;
        dayStats[d.date].hours[d.hour] = (dayStats[d.date].hours[d.hour] || 0) + 1;
        dayStats[d.date].vehicles[d.vehicle] = (dayStats[d.date].vehicles[d.vehicle] || 0) + 1;
    });
    const dayLabels = Object.keys(dayStats).sort();
    createChart('dailyChart', 'line', dayLabels, [
        { label: 'Nhập', data: dayLabels.map(d => dayStats[d].in), borderColor: '#f26522', tension: 0.3 },
        { label: 'Xuất', data: dayLabels.map(d => dayStats[d].out), borderColor: '#00467f', tension: 0.3 }
    ]);

    // 4. laneChart: Phân tích theo Kho (Tuyến)
    const lanes = {};
    filteredData.forEach(d => {
        if (!lanes[d.stoppoint]) lanes[d.stoppoint] = 0;
        lanes[d.stoppoint]++;
    });
    const sortedLanes = Object.entries(lanes).sort((a, b) => b[1] - a[1]).slice(0, 5);
    createChart('laneChart', 'bar', sortedLanes.map(l => l[0].replace('Kho Trung Chuyển', 'KTC')), [{
        label: 'Số lượng xe',
        data: sortedLanes.map(l => l[1]),
        backgroundColor: '#6c5ce7'
    }], { indexAxis: 'y' });

    // 5. compare-daily Table
    const tbody = document.getElementById('compare-daily');
    if (tbody) {
        tbody.innerHTML = '';
        dayLabels.forEach((date, idx) => {
            const stat = dayStats[date];
            const total = stat.in + stat.out;
            const weightTons = stat.weight.toFixed(1);

            let peakHour = "-"; let maxH = 0;
            for (let h in stat.hours) { if (stat.hours[h] > maxH) { maxH = stat.hours[h]; peakHour = h; } }

            let topV = "-"; let maxV = 0;
            for (let v in stat.vehicles) {
                if (v && v !== "0.00E+00" && stat.vehicles[v] > maxV) { maxV = stat.vehicles[v]; topV = v; }
            }

            let trend = "-";
            if (idx > 0) {
                const prevTotal = dayStats[dayLabels[idx - 1]].in + dayStats[dayLabels[idx - 1]].out;
                if (total > prevTotal) trend = '<span style="color:var(--green)">▲ Tăng</span>';
                else if (total < prevTotal) trend = '<span style="color:var(--red)">▼ Giảm</span>';
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHTML(date)}</td>
                <td>${stat.in.toLocaleString('vi-VN')}</td>
                <td>${stat.out.toLocaleString('vi-VN')}</td>
                <td style="font-weight:700; color:var(--accent)">${total.toLocaleString('vi-VN')}</td>
                <td>${stat.weight.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}</td>
                <td>${escapeHTML(peakHour)}</td>
                <td>${escapeHTML(topV)}</td>
                <td>${trend}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // 6. Heatmap
    const heatTable = document.getElementById('heatmap-table');
    if (heatTable) {
        heatTable.innerHTML = '';

        // Build header
        const thead = document.createElement('tr');
        thead.innerHTML = '<th>Ngày</th>';
        const allHours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0') + ':00');
        allHours.forEach(h => { thead.innerHTML += `<th>${escapeHTML(h).substring(0, 2)}h</th>`; });
        heatTable.appendChild(thead);

        const heatCounts = {};
        filteredData.forEach(d => {
            if (!heatCounts[d.date]) heatCounts[d.date] = {};
            heatCounts[d.date][d.hour] = (heatCounts[d.date][d.hour] || 0) + 1;
        });

        // Find max count for color scale
        let maxCount = 0;
        dayLabels.forEach(date => {
            allHours.forEach(h => {
                const count = heatCounts[date]?.[h] || 0;
                if (count > maxCount) maxCount = count;
            });
        });

        // Build rows
        dayLabels.forEach(date => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td style="font-weight:600">${escapeHTML(date)}</td>`;
            allHours.forEach(h => {
                const count = heatCounts[date]?.[h] || 0;
                const intensity = maxCount > 0 ? count / maxCount : 0;
                let bg = 'transparent'; let col = 'var(--text2)';
                if (count > 0) {
                    bg = `rgba(242, 101, 34, ${intensity * 0.8 + 0.2})`; // GHN Orange
                    col = intensity > 0.5 ? '#fff' : 'var(--text)';
                }
                tr.innerHTML += `<td style="background:${bg}; color:${col}; text-align:center">${count || '-'}</td>`;
            });
            heatTable.appendChild(tr);
        });
    }

    // ==========================================
    // TAB: BIỂU ĐỒ CHI TIẾT
    // ==========================================
    const advLane = document.getElementById('chart-filter-lane')?.value || "ALL";
    const advStop = document.getElementById('chart-filter-stop')?.value || "ALL";
    const advVeh = document.getElementById('chart-filter-vehicle')?.value || "ALL";
    const advHFrom = document.getElementById('chart-filter-hour-from')?.value || "ALL";
    const advHTo = document.getElementById('chart-filter-hour-to')?.value || "ALL";

    let detailData = filteredData;
    if (advLane !== "ALL") detailData = detailData.filter(d => d.stoppoint === advLane);
    if (advStop !== "ALL") detailData = detailData.filter(d => d.stoppoint === advStop);
    if (advVeh !== "ALL") detailData = detailData.filter(d => d.vehicle === advVeh);
    if (advHFrom !== "ALL" && advHFrom !== "") detailData = detailData.filter(d => d.hour >= advHFrom);
    if (advHTo !== "ALL" && advHTo !== "") detailData = detailData.filter(d => d.hour <= advHTo);

    const detailHourStats = {};
    const detailWeightBuckets = { '< 1.5 tấn': 0, '1.5 - 3.5 tấn': 0, '3.5 - 7 tấn': 0, '> 7 tấn': 0 };

    hourLabels.forEach(h => detailHourStats[h] = { in: 0, out: 0 });
    detailData.forEach(d => {
        if (detailHourStats[d.hour]) {
            if (d.type === "Nhập") detailHourStats[d.hour].in++;
            else detailHourStats[d.hour].out++;
        }
        if (d.capacity < 1500) detailWeightBuckets['< 1.5 tấn']++;
        else if (d.capacity < 3500) detailWeightBuckets['1.5 - 3.5 tấn']++;
        else if (d.capacity < 7000) detailWeightBuckets['3.5 - 7 tấn']++;
        else detailWeightBuckets['> 7 tấn']++;
    });

    createChart('detailHourly', 'line', hourLabels, [
        { label: 'Tổng xe', data: hourLabels.map(h => detailHourStats[h].in + detailHourStats[h].out), borderColor: '#f26522', tension: 0.3 }
    ]);
    createChart('detailVehicle', 'doughnut', Object.keys(detailWeightBuckets), [{
        data: Object.values(detailWeightBuckets), backgroundColor: ['#00cec9', '#6c5ce7', '#fdcb6e', '#ff7675']
    }]);

    const top3Lanes = sortedLanes.slice(0, 3).map(l => l[0]);
    const laneDayData = top3Lanes.map((lane, idx) => {
        return {
            label: lane.replace('Kho Trung Chuyển', 'KTC'),
            data: dayLabels.map(d => detailData.filter(x => x.date === d && x.stoppoint === lane).length),
            backgroundColor: idx === 0 ? '#f26522' : (idx === 1 ? '#00467f' : '#6c5ce7')
        };
    });
    createChart('laneDayChart', 'bar', dayLabels, laneDayData, { scales: { x: { stacked: true }, y: { stacked: true } } });

    createChart('vehHourCompare', 'bar', hourLabels, [
        { label: 'Nhập', data: hourLabels.map(h => detailHourStats[h].in), backgroundColor: '#f26522' },
        { label: 'Xuất', data: hourLabels.map(h => detailHourStats[h].out), backgroundColor: '#00467f' }
    ]);

    createChart('multiDayChart', 'line', dayLabels, [
        { label: 'Lưu lượng', data: dayLabels.map(d => dayStats[d].in + dayStats[d].out), borderColor: '#00cec9', tension: 0.3, fill: true, backgroundColor: 'rgba(0, 206, 201, 0.2)' }
    ]);

    const partnerData = { GHN: 0, NCC: 0 };
    filteredData.forEach(d => {
        if (d.partner === "GHN" || d.partner === "NỘI BỘ" || d.partner.toLowerCase().includes("sorting")) partnerData.GHN++;
        else partnerData.NCC++;
    });
    createChart('partnerChart', 'doughnut', ['Xe GHN', 'Xe NCC'], [{
        data: [partnerData.GHN, partnerData.NCC], backgroundColor: ['#f26522', '#00467f']
    }]);

    const partnerTable = document.getElementById('partner-table');
    if (partnerTable) {
        partnerTable.innerHTML = '';
        dayLabels.forEach(d => {
            const dayGHN = filteredData.filter(x => x.date === d && (x.partner === "GHN" || x.partner === "NỘI BỘ" || x.partner.toLowerCase().includes("sorting"))).length;
            const dayNCC = (dayStats[d].in + dayStats[d].out) - dayGHN;
            partnerTable.innerHTML += `<tr><td>${escapeHTML(d)}</td><td style="color:#f26522; font-weight:bold">${dayGHN}</td><td style="color:#00467f; font-weight:bold">${dayNCC}</td><td>${dayGHN + dayNCC}</td></tr>`;
        });
    }

    // ==========================================
    // TAB: SẢN LƯỢNG & KG
    // ==========================================
    const prodTotalKg = filteredData.reduce((s, d) => s + d.weight, 0);
    if (document.getElementById('prod-total-kg')) document.getElementById('prod-total-kg').textContent = prodTotalKg.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
    if (document.getElementById('prod-avg-kg')) document.getElementById('prod-avg-kg').textContent = (prodTotalKg / (dayLabels.length || 1)).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
    if (document.getElementById('prod-avg-per-truck')) document.getElementById('prod-avg-per-truck').textContent = (prodTotalKg / (filteredData.length || 1)).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
    let peakDay = "-"; let maxDayW = 0;
    dayLabels.forEach(d => { if (dayStats[d].weight > maxDayW) { maxDayW = dayStats[d].weight; peakDay = d; } });
    if (document.getElementById('prod-peak-day')) document.getElementById('prod-peak-day').textContent = peakDay;

    const prodDayFilter = document.getElementById('prod-day-filter')?.value || "ALL";
    let prodData = filteredData;
    if (prodDayFilter !== "ALL") prodData = prodData.filter(d => d.date === prodDayFilter);

    createChart('prodDailyKgChart', 'bar', dayLabels, [
        { label: 'Tấn hàng', data: dayLabels.map(d => dayStats[d].weight.toFixed(1)), backgroundColor: '#fdcb6e' }
    ]);

    const weightByCap = { '< 1.5 tấn': 0, '1.5 - 3.5 tấn': 0, '3.5 - 7 tấn': 0, '> 7 tấn': 0 };
    prodData.forEach(d => {
        if (d.capacity < 1500) weightByCap['< 1.5 tấn'] += d.weight;
        else if (d.capacity < 3500) weightByCap['1.5 - 3.5 tấn'] += d.weight;
        else if (d.capacity < 7000) weightByCap['3.5 - 7 tấn'] += d.weight;
        else weightByCap['> 7 tấn'] += d.weight;
    });
    createChart('prodVehicleKgChart', 'doughnut', Object.keys(weightByCap), [{
        data: Object.values(weightByCap).map(w => w.toFixed(1)), backgroundColor: ['#00cec9', '#6c5ce7', '#fdcb6e', '#ff7675']
    }]);

    const hourWeight = {};
    prodData.forEach(d => {
        if (!hourWeight[d.hour]) hourWeight[d.hour] = 0;
        hourWeight[d.hour] += d.weight;
    });
    createChart('prodHourChart', 'bar', hourLabels, [
        { label: 'Tấn hàng', data: hourLabels.map(h => (hourWeight[h] || 0).toFixed(1)), backgroundColor: '#f26522' }
    ]);

    const prodHourTable = document.getElementById('prod-hour-table');
    if (prodHourTable) {
        prodHourTable.innerHTML = '';
        const totalW = hourLabels.reduce((s, h) => s + (hourWeight[h] || 0), 0);
        hourLabels.forEach(h => {
            const w = hourWeight[h] || 0;
            const v = prodData.filter(d => d.hour === h).length;
            const pct = totalW > 0 ? ((w / totalW) * 100).toFixed(1) : 0;
            prodHourTable.innerHTML += `<tr><td>${escapeHTML(h).substring(0, 2)}h</td><td>${v.toLocaleString('vi-VN')}</td><td style="color:var(--orange)">${w.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}</td><td>${pct}%</td></tr>`;
        });
    }

    // ==========================================
    // TAB: CẢNH BÁO
    // ==========================================
    if (document.getElementById('alert-total-in')) document.getElementById('alert-total-in').textContent = totalIn.toLocaleString('vi-VN');
    if (document.getElementById('alert-total-out')) document.getElementById('alert-total-out').textContent = totalOut.toLocaleString('vi-VN');
    if (document.getElementById('alert-total-kg')) document.getElementById('alert-total-kg').textContent = (weightIn + weightOut).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
    if (document.getElementById('alert-avg-kg')) document.getElementById('alert-avg-kg').textContent = ((weightIn + weightOut) / (dayLabels.length || 1)).toLocaleString('vi-VN', { maximumFractionDigits: 1 });

    const peakTable = document.getElementById('peak-hour-table');
    if (peakTable) {
        peakTable.innerHTML = '';
        const avgTotal = (totalIn + totalOut) / (hourLabels.length || 1);
        dayLabels.forEach(date => {
            let peakHour = "-"; let maxH = 0;
            for (let h in dayStats[date].hours) { if (dayStats[date].hours[h] > maxH) { maxH = dayStats[date].hours[h]; peakHour = h; } }
            if (maxH > avgTotal * 1.3) {
                peakTable.innerHTML += `<tr><td>${escapeHTML(date)}</td><td style="color:var(--red)">${escapeHTML(peakHour)}</td><td>${maxH.toLocaleString('vi-VN')}</td><td><span style="color:var(--red)">Vượt mức</span></td></tr>`;
            }
        });
    }
}
