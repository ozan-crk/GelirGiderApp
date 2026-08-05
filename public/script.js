document.addEventListener('DOMContentLoaded', () => {
    let transactions = [];
    let accounts = [];
    let expenseChartInstance = null;
    
    let currentFilterMonth = 'all'; 
    let currentFilterType = 'all';
    let editId = null; 

    const form = document.getElementById('transaction-form');
    const transactionsList = document.getElementById('transactions-list');
    const emptyState = document.getElementById('empty-state');
    const tableContainer = document.querySelector('.table-container');
    const dateInput = document.getElementById('date');
    const timeInput = document.getElementById('time');
    const kpiAccounts = document.getElementById('kpi-accounts');
    const newAccountForm = document.getElementById('new-account-form');
    const filterMonth = document.getElementById('filter-month');
    const filterType = document.getElementById('filter-type');

    const setNow = () => {
        const n = new Date();
        const local = new Date(n.getTime() - (n.getTimezoneOffset() * 60000));
        const iso = local.toISOString();
        dateInput.value = iso.split('T')[0];
        timeInput.value = iso.split('T')[1].substring(0, 5);
    };
    setNow();

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Outfit', sans-serif";

    const formatCurrency = (amount) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(amount);
    const formatDate = (dateString) => {
        const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' };
        return new Date(dateString).toLocaleDateString('tr-TR', options);
    };
    
    const populateMonthFilter = () => {
        const months = new Set();
        transactions.forEach(t => {
            const d = new Date(t.date);
            const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}`;
            months.add(val);
        });
        const currentVal = filterMonth.value;
        filterMonth.innerHTML = '<option value="all">Tüm Zamanlar</option>';
        [...months].sort().reverse().forEach(m => {
            const [y, mo] = m.split('-');
            const date = new Date(y, mo-1, 1);
            const label = date.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
            filterMonth.innerHTML += `<option value="${m}">${label}</option>`;
        });
        if ([...months].includes(currentVal)) {
            filterMonth.value = currentVal;
        }
    };

    const loadData = async () => {
        const d = new Date();
        await fetch('/api/generate-recurring', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({year: d.getFullYear(), month: d.getMonth()+1})
        });

        const [accRes, txRes] = await Promise.all([
            fetch('/api/accounts'),
            fetch('/api/transactions')
        ]);
        
        accounts = await accRes.json();
        transactions = await txRes.json();

        updateAccountSelects();
        populateMonthFilter();
        updateUI();
    };

    const updateAccountSelects = () => {
        const accountIdSelect = document.getElementById('account_id');
        const accountFromSelect = document.getElementById('account-from');
        const accountToSelect = document.getElementById('account-to');
        
        const options = accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        accountIdSelect.innerHTML = options;
        accountFromSelect.innerHTML = options;
        accountToSelect.innerHTML = options;
    };

    const updateUI = () => {
        const accountBalances = {};
        accounts.forEach(a => accountBalances[a.id] = a.initial_balance || 0);

        const completedTxs = transactions.filter(t => t.status === 'completed');
        completedTxs.forEach(t => {
            if (accountBalances[t.account_id] !== undefined) {
                if (t.type === 'income') accountBalances[t.account_id] += t.amount;
                if (t.type === 'expense') accountBalances[t.account_id] -= t.amount;
            }
        });

        let kpiHtml = '';
        let totalNet = 0;
        accounts.forEach(a => {
            const bal = accountBalances[a.id];
            totalNet += bal;
            kpiHtml += `
            <div class="kpi-card" style="position:relative;">
                <button onclick="openCorrectModal('${a.id}', '${a.name}', ${bal})" style="position:absolute; top:1rem; right:1rem; background:none; border:none; color:var(--text-secondary); cursor:pointer; font-size:1.2rem; transition:color 0.2s;" onmouseover="this.style.color='var(--accent-blue)'" onmouseout="this.style.color='var(--text-secondary)'"><i class="ph-bold ph-pencil-simple"></i></button>
                <div class="kpi-icon" style="background: rgba(255,255,255,0.1); color: #fff;"><i class="ph-bold ph-bank"></i></div>
                <div class="kpi-details">
                    <h3>${a.name}</h3>
                    <p>${formatCurrency(bal)}</p>
                </div>
            </div>`;
        });
        
        kpiHtml = `
            <div class="kpi-card balance">
                <div class="kpi-icon"><i class="ph-bold ph-scales"></i></div>
                <div class="kpi-details">
                    <h3>TOPLAM KASA (Net)</h3>
                    <p style="color: var(--accent-blue); font-size:2rem;">${formatCurrency(totalNet)}</p>
                </div>
            </div>
        ` + kpiHtml;
        kpiAccounts.innerHTML = kpiHtml;

        // Calculate Projected Balances for planned transactions globally
        const allPlanned = transactions.filter(t => t.status === 'planned').sort((a, b) => new Date(a.date) - new Date(b.date));
        let runningNet = totalNet;
        allPlanned.forEach(t => {
            if (t.type === 'income') runningNet += t.amount;
            else if (t.type === 'expense') runningNet -= t.amount;
            t.projectedBalance = runningNet;
        });

        let filteredTxs = [...transactions];
        if (currentFilterMonth !== 'all') {
            filteredTxs = filteredTxs.filter(t => {
                const d = new Date(t.date);
                return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}` === currentFilterMonth;
            });
            document.getElementById('chart-title-month').textContent = `(${filterMonth.options[filterMonth.selectedIndex].text})`;
        } else {
            document.getElementById('chart-title-month').textContent = `(Tümü)`;
        }
        
        if (currentFilterType !== 'all') {
            filteredTxs = filteredTxs.filter(t => t.type === currentFilterType);
        }

        let monthlyIncComp = 0, monthlyExpComp = 0, monthlyIncPlan = 0, monthlyExpPlan = 0;
        filteredTxs.forEach(t => {
            if (t.category === 'Transfer') return; 
            
            if (t.type === 'income') {
                if (t.status === 'completed') monthlyIncComp += t.amount;
                else monthlyIncPlan += t.amount;
            } else if (t.type === 'expense') {
                if (t.status === 'completed') monthlyExpComp += t.amount;
                else monthlyExpPlan += t.amount;
            }
        });

        const elIncComp = document.getElementById('monthly-income-completed');
        const elExpComp = document.getElementById('monthly-expense-completed');
        const elIncPlan = document.getElementById('monthly-income-planned');
        const elExpPlan = document.getElementById('monthly-expense-planned');

        if(elIncComp) elIncComp.textContent = formatCurrency(monthlyIncComp);
        if(elExpComp) elExpComp.textContent = formatCurrency(monthlyExpComp);
        if(elIncPlan) elIncPlan.textContent = formatCurrency(monthlyIncPlan);
        if(elExpPlan) elExpPlan.textContent = formatCurrency(monthlyExpPlan);

        renderTable(filteredTxs, accountBalances);
        updateChart(filteredTxs);
    };

    const renderTable = (filteredTxs, accountBalances) => {
        transactionsList.innerHTML = '';
        
        if (filteredTxs.length === 0) {
            emptyState.style.display = 'block';
            tableContainer.style.display = 'none';
        } else {
            emptyState.style.display = 'none';
            tableContainer.style.display = 'block';
            
            const sortedTransactions = [...filteredTxs].sort((a, b) => new Date(b.date) - new Date(a.date));

            sortedTransactions.forEach(t => {
                const statusBadge = t.status === 'completed' 
                    ? `<span class="badge badge-completed">Gerçekleşti</span>`
                    : `<span class="badge badge-planned">Olası/Planlanan</span>`;
                
                const accountName = t.account_name || 'Bilinmiyor';

                let typeSign = '';
                let amountClass = '';
                if (t.type === 'income') { typeSign = '+'; amountClass = 'amount-income'; }
                else if (t.type === 'expense') { typeSign = '-'; amountClass = 'amount-expense'; }
                else { typeSign = ''; amountClass = 'amount-expense'; }

                let actionBtns = '';
                if (t.status === 'planned') {
                    actionBtns += `<button class="action-btn success-btn" onclick="toggleStatus('${t.id}', 'completed')" title="Ödendi İşaretle"><i class="ph-bold ph-check"></i></button>`;
                } else {
                    actionBtns += `<button class="action-btn warning-btn" onclick="toggleStatus('${t.id}', 'planned')" title="Planlanan'a Çevir"><i class="ph-bold ph-arrow-u-up-left"></i></button>`;
                }
                
                actionBtns += `<button class="action-btn" style="background:rgba(59,130,246,0.1); color:var(--accent-blue);" onclick="editTransaction('${t.id}')" title="Düzenle"><i class="ph-bold ph-pencil"></i></button>`;
                actionBtns += `<button class="action-btn delete-btn" onclick="deleteTransaction('${t.id}')" title="Sil"><i class="ph-bold ph-trash"></i></button>`;

                let projectedHtml = '';
                if (t.status === 'planned' && t.projectedBalance !== undefined) {
                    const pColor = t.projectedBalance < 0 ? 'var(--danger)' : 'var(--text-secondary)';
                    const icon = t.projectedBalance < 0 ? '<i class="ph-bold ph-warning"></i>' : '<i class="ph-bold ph-info"></i>';
                    projectedHtml = `<div style="font-size: 0.8rem; color: ${pColor}; margin-top: 0.3rem;">${icon} İşlem Sonrası Toplam Net Kasa: ${formatCurrency(t.projectedBalance)}</div>`;
                }

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${formatDate(t.date)}</td>
                    <td><span class="badge" style="background:rgba(255,255,255,0.1);">${accountName}</span></td>
                    <td>${statusBadge}</td>
                    <td><span class="badge">${t.category}</span></td>
                    <td>
                        <div style="font-weight:500">${t.description} ${t.is_recurring ? '<i class="ph-bold ph-arrows-clockwise" title="Düzenli İşlem" style="color:var(--accent-blue)"></i>' : ''}</div>
                        ${projectedHtml}
                    </td>
                    <td class="${amountClass}">
                        ${typeSign}${formatCurrency(t.amount)}
                    </td>
                    <td>
                        <div style="display:flex; gap:0.5rem; align-items:center;">
                            ${actionBtns}
                        </div>
                    </td>
                `;
                transactionsList.appendChild(tr);
            });
        }
    };

    window.deleteTransaction = async (id) => {
        await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
        loadData();
    };
    
    window.toggleStatus = async (id, newStatus) => {
        await fetch(`/api/transactions/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        loadData();
    };

    window.openCorrectModal = (id, name, currentBal) => {
        document.getElementById('correct-account-id').value = id;
        document.getElementById('correct-account-name').value = name;
        document.getElementById('correct-account-target').value = currentBal;
        document.getElementById('correct-account-modal').style.display = 'block';
    };

    window.exportData = async () => {
        const res = await fetch('/api/export');
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        a.download = `gelirgider_yedek_${dateStr}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    window.importData = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        if (!confirm("DİKKAT: Mevcut tüm verileriniz SİLİNECEK ve yerine seçtiğiniz dosyadaki veriler yüklenecektir. Onaylıyor musunuz?")) {
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                const res = await fetch('/api/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                if (res.ok) {
                    alert("Veriler başarıyla geri yüklendi!");
                    loadData();
                } else {
                    const err = await res.json();
                    alert("Hata: " + err.error);
                }
            } catch (err) {
                alert("Dosya okunamadı veya geçersiz bir JSON formatı.");
            }
            event.target.value = '';
        };
        reader.readAsText(file);
    };

    window.editTransaction = (id) => {
        const t = transactions.find(x => x.id === id);
        if (!t) return;
        
        if (t.type === 'transfer') {
            alert("Virman işlemleri parçalı olduğundan şu an için düzenlenemez. Lütfen silip yeniden ekleyin.");
            return;
        }

        editId = id;
        
        document.querySelector(`input[name="type"][value="${t.type}"]`).click();
        document.querySelector(`input[name="status"][value="${t.status}"]`).checked = true;
        document.getElementById('amount').value = t.amount;
        
        // Tarih ve saat ayır
        const dParts = t.date.includes('T') ? t.date.split('T') : [t.date, '00:00'];
        document.getElementById('date').value = dParts[0];
        document.getElementById('time').value = dParts[1].substring(0, 5);
        
        document.getElementById('description').value = t.description;
        
        setTimeout(() => {
            document.getElementById('category').value = t.category;
        }, 50);
        document.getElementById('account_id').value = t.account_id;

        document.querySelector('.submit-btn').innerHTML = 'Değişiklikleri Kaydet <i class="ph-bold ph-floppy-disk"></i>';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const updateChart = (filteredTxs) => {
        const expenses = filteredTxs.filter(t => t.type === 'expense' && t.status === 'completed' && t.category !== 'Transfer');
        const categoryTotals = expenses.reduce((acc, t) => {
            acc[t.category] = (acc[t.category] || 0) + t.amount;
            return acc;
        }, {});

        const labels = Object.keys(categoryTotals);
        const data = Object.values(categoryTotals);

        const ctx = document.getElementById('expenseChart').getContext('2d');
        if (expenseChartInstance) expenseChartInstance.destroy();

        if (labels.length === 0) {
            expenseChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: { labels: ['Veri Yok'], datasets: [{ data: [1], backgroundColor: ['rgba(255,255,255,0.05)'], borderWidth: 0 }] },
                options: { cutout: '80%', plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false }
            });
            return;
        }

        const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
        expenseChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'right', labels: { color: '#f8fafc', padding: 20 } } } }
        });
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const type = document.querySelector('input[name="type"]:checked').value;
        const status = document.querySelector('input[name="status"]:checked').value;
        const amount = parseFloat(document.getElementById('amount').value);
        
        const dateVal = document.getElementById('date').value;
        const timeVal = document.getElementById('time').value || '00:00';
        const date = `${dateVal}T${timeVal}`;
        
        const description = document.getElementById('description').value;
        const is_recurring = document.getElementById('is_recurring').checked;
        const category = document.getElementById('category').value;
        const account_id = document.getElementById('account_id').value;

        if (type === 'transfer' && !editId) {
            const accFrom = document.getElementById('account-from').value;
            const accTo = document.getElementById('account-to').value;
            if (accFrom === accTo) return alert('Gönderen ve Alıcı kasa aynı olamaz!');
            
            await fetch('/api/transfers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id_from: 't_'+Date.now(),
                    id_to: 't_'+(Date.now()+1),
                    account_from: accFrom,
                    account_to: accTo,
                    amount, description, date, status
                })
            });
        } else {
            const payload = {
                id: editId ? editId : 't_'+Date.now(), 
                type, status, amount, category, description, date, account_id, is_recurring
            };

            const url = editId ? `/api/transactions/${editId}` : '/api/transactions';
            const method = editId ? 'PUT' : 'POST';

            await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }
        
        editId = null;
        document.querySelector('.submit-btn').innerHTML = 'İşlemi Kaydet <i class="ph-bold ph-plus"></i>';
        
        document.getElementById('amount').value = '';
        document.getElementById('description').value = '';
        document.getElementById('is_recurring').checked = false;
        
        setNow();
        loadData();
    });

    newAccountForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('new-account-name').value;
        const bal = parseFloat(document.getElementById('new-account-balance').value) || 0;
        await fetch('/api/accounts', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: 'acc_'+Date.now(), name, initial_balance: bal })
        });
        document.getElementById('new-account-modal').style.display = 'none';
        document.getElementById('new-account-name').value = '';
        loadData();
    });

    document.getElementById('correct-account-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('correct-account-id').value;
        const target_balance = parseFloat(document.getElementById('correct-account-target').value);
        
        const n = new Date();
        const local = new Date(n.getTime() - (n.getTimezoneOffset() * 60000));
        const date = local.toISOString().slice(0, 16);

        await fetch(`/api/accounts/${id}/correct`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ target_balance, date })
        });
        
        document.getElementById('correct-account-modal').style.display = 'none';
        loadData();
    });

    const updateCategories = (type) => {
        const categorySelect = document.getElementById('category');
        categorySelect.innerHTML = '<option value="" disabled selected>Kategori Seçin</option>';
        if (type === 'transfer') return;
        
        const categories = type === 'income' 
            ? ['Maaş', 'Yatırım', 'Prim', 'Tahsilat', 'Diğer']
            : ['Kira', 'Fatura', 'Market', 'Personel', 'Vergi', 'Malzeme', 'Diğer'];
            
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            categorySelect.appendChild(option);
        });
    };

    document.querySelectorAll('input[name="type"]').forEach(input => {
        input.addEventListener('change', (e) => {
            const t = e.target.value;
            updateCategories(t);
            
            if (t === 'transfer') {
                document.getElementById('transfer-accounts').style.display = 'grid';
                document.getElementById('single-account-group').style.display = 'none';
                document.getElementById('category-row').style.display = 'none';
                
                document.getElementById('account_id').removeAttribute('required');
                document.getElementById('category').removeAttribute('required');
                document.getElementById('account-from').setAttribute('required', 'true');
                document.getElementById('account-to').setAttribute('required', 'true');
            } else {
                document.getElementById('transfer-accounts').style.display = 'none';
                document.getElementById('single-account-group').style.display = 'block';
                document.getElementById('category-row').style.display = 'grid';
                
                document.getElementById('account_id').setAttribute('required', 'true');
                document.getElementById('category').setAttribute('required', 'true');
                document.getElementById('account-from').removeAttribute('required');
                document.getElementById('account-to').removeAttribute('required');
            }
        });
    });

    filterMonth.addEventListener('change', (e) => { currentFilterMonth = e.target.value; updateUI(); });
    filterType.addEventListener('change', (e) => { currentFilterType = e.target.value; updateUI(); });

    updateCategories('income');
    loadData();
});
