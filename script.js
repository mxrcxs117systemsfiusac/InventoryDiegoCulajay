/**
 * Gestión de Inventario Doméstico - Lógica Principal
 * PWA + Vanilla JS + IndexedDB
 */

// ==========================================
// 1. CONFIGURATION Y ESTADOS
// ==========================================
const DB_NAME = 'InventoryDB';
const DB_VERSION = 2;

const STORE_PRODUCTS = 'products';
const STORE_HISTORY = 'history';
const STORE_SHOPPING = 'shopping_list';

// Estado global
let chartCategory = null;
let chartExpired = null;
let html5QrCode = null;

// ==========================================
// 2. BASE DE DATOS LOCAL (IndexedDB)
// ==========================================
const db = {
    instance: null,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (e) => reject(e.target.error);

            request.onsuccess = (e) => {
                this.instance = e.target.result;
                resolve(this.instance);
            };

            request.onupgradeneeded = (e) => {
                const database = e.target.result;

                // Store para productos (activos)
                if (!database.objectStoreNames.contains(STORE_PRODUCTS)) {
                    database.createObjectStore(STORE_PRODUCTS, { keyPath: 'id', autoIncrement: true });
                }

                // Store para historial
                if (!database.objectStoreNames.contains(STORE_HISTORY)) {
                    database.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true });
                }

                // Store para lista de compras
                if (!database.objectStoreNames.contains(STORE_SHOPPING)) {
                    database.createObjectStore(STORE_SHOPPING, { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    },

    async getAll(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.instance) return resolve([]);
            const tx = this.instance.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async add(storeName, item) {
        return new Promise((resolve, reject) => {
            const tx = this.instance.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.add(item);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async put(storeName, item) {
        return new Promise((resolve, reject) => {
            const tx = this.instance.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(item);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async delete(storeName, id) {
        return new Promise((resolve, reject) => {
            const tx = this.instance.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async get(storeName, id) {
        return new Promise((resolve, reject) => {
            const tx = this.instance.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async clear(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.instance.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
};

// ==========================================
// 3. LÓGICA DE NEGOCIO
// ==========================================
const Logic = {
    calculateDaysRemaining(expiryDateStr) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [year, month, day] = expiryDateStr.split('-').map(Number);
        const expiry = new Date(year, month - 1, day);
        expiry.setHours(0, 0, 0, 0);

        const diffTime = expiry - today;
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    },

    determineStatus(daysRemaining) {
        if (daysRemaining > 7) return 'safe';
        if (daysRemaining > 0 && daysRemaining <= 7) return 'warning';
        return 'danger';
    },

    refreshProductStatus(product) {
        product.daysRemaining = this.calculateDaysRemaining(product.expiryDate);
        product.statusObj = this.determineStatus(product.daysRemaining);
        return product;
    },

    async loadActiveInventory() {
        let products = await db.getAll(STORE_PRODUCTS);
        const updated = products.map(p => this.refreshProductStatus(p));
        // Ordenar por fecha de vencimiento (más próximo primero)
        updated.sort((a, b) => a.daysRemaining - b.daysRemaining);
        return updated;
    },

    async loadHistory() {
        let history = await db.getAll(STORE_HISTORY);
        history.sort((a, b) => new Date(b.dateRemoved) - new Date(a.dateRemoved));
        return history;
    },

    async addProduct(data) {
        const item = {
            ...data,
            price: Number(data.price) || 0,
            dateAdded: new Date().toISOString(),
        };
        await db.add(STORE_PRODUCTS, item);
        await UI.refreshAll();
    },

    async moveToHistory(productId, finalStatus) {
        const product = await db.get(STORE_PRODUCTS, productId);
        if (!product) return;

        const historyItem = {
            ...product,
            finalStatus: finalStatus, // 'consumed' | 'wasted'
            dateRemoved: new Date().toISOString()
        };

        await db.add(STORE_HISTORY, historyItem);
        await db.delete(STORE_PRODUCTS, productId);
        await UI.refreshAll();
    },

    async removePermanent(productId) {
        await db.delete(STORE_PRODUCTS, productId);
        await UI.refreshAll();
    },

    async getShoppingList() {
        return await db.getAll(STORE_SHOPPING);
    },

    async addToShoppingList(name) {
        const item = {
            name: name,
            checked: false,
            dateAdded: new Date().toISOString()
        };
        await db.add(STORE_SHOPPING, item);
    },

    async toggleShoppingItem(id, checked) {
        const item = await db.get(STORE_SHOPPING, id);
        if (item) {
            item.checked = checked;
            await db.put(STORE_SHOPPING, item);
        }
    },

    async clearCheckedShopping() {
        const items = await this.getShoppingList();
        for (const item of items) {
            if (item.checked) {
                await db.delete(STORE_SHOPPING, item.id);
            }
        }
    }
};

// ==========================================
// 4. INTERFAZ DE USUARIO (UI)
// ==========================================
const UI = {
    // --- Renderers ---
    async refreshAll() {
        const products = await Logic.loadActiveInventory();
        const history = await Logic.loadHistory();
        const shopping = await Logic.getShoppingList();

        this.renderDashboard(products, history);
        this.renderInventory(products);
        this.renderHistory(history);
        this.renderShoppingList(shopping);
        this.checkAlerts(products);
    },

    renderDashboard(products, history) {
        // Stats
        let safe = 0, warning = 0, danger = 0;
        let categories = {};

        products.forEach(p => {
            if (p.statusObj === 'safe') safe++;
            else if (p.statusObj === 'warning') warning++;
            else if (p.statusObj === 'danger') danger++;

            categories[p.category] = (categories[p.category] || 0) + 1;
        });

        document.getElementById('stat-total').innerText = products.length;
        document.getElementById('stat-safe').innerText = safe;
        document.getElementById('stat-warning').innerText = warning;
        document.getElementById('stat-danger').innerText = danger;

        // Pérdida Económica
        const loss = history
            .filter(h => h.finalStatus === 'wasted')
            .reduce((sum, h) => sum + (h.price || 0), 0);
        document.getElementById('stat-loss').innerText = `Q${loss.toFixed(2)}`;

        this.updateCharts(categories, history);
    },

    checkAlerts(products) {
        const container = document.getElementById('alerts-container');
        const countSafe = products.filter(p => p.statusObj === 'safe').length;
        const alerts = products.filter(p => p.statusObj === 'warning' || p.statusObj === 'danger');

        if (alerts.length === 0) {
            container.innerHTML = `<div class="text-center text-ios-textSub py-6 text-sm">Tu inventario está en excelentes condiciones.</div>`;
            return;
        }

        let html = '<div class="divide-y divide-ios-border">';
        // Tomar top 5 alertas
        alerts.slice(0, 5).forEach(p => {
            const icon = p.statusObj === 'danger' ? 'fa-triangle-exclamation text-status-danger' : 'fa-clock text-status-warning';
            const textClass = p.statusObj === 'danger' ? 'text-status-danger font-semibold' : 'text-status-warning font-medium';
            const daysText = p.daysRemaining < 0 ? `Vencido hace ${Math.abs(p.daysRemaining)} días` : (p.daysRemaining === 0 ? 'Vence hoy' : `Vence en ${p.daysRemaining} días`);

            html += `
            <div class="px-4 py-3 flex items-center gap-3 hover:bg-ios-sec transition">
                <i class="fa-solid ${icon} text-lg w-6 text-center"></i>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-ios-textTitle truncate">${p.name}</p>
                    <p class="text-xs ${textClass}">${daysText}</p>
                </div>
                <button onclick="window.UI.quickAction(${p.id}, 'consumed')" class="text-xs bg-ios-black text-white px-3 py-1.5 rounded-full hover:opacity-80 transition font-semibold">Consumir</button>
            </div>`;
        });
        html += '</div>';

        container.innerHTML = html;

        // Notificaciones PWA (si está permitido)
        this.showNativeNotification(alerts);
    },

    showNativeNotification(alerts) {
        if (!("Notification" in window)) return;
        if (Notification.permission === "granted") {
            const dangerCount = alerts.filter(a => a.statusObj === 'danger').length;
            if (dangerCount > 0 && sessionStorage.getItem('notified') !== 'true') {
                new Notification("Alerta de Inventario", {
                    body: `Tienes ${dangerCount} productos vencidos. ¡Revisa tu despensa!`,
                    icon: "https://cdn-icons-png.flaticon.com/512/3500/3500833.png"
                });
                sessionStorage.setItem('notified', 'true');
            }
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission();
        }
    },

    renderInventory(products) {
        const container = document.getElementById('inventory-list');
        const filterCat = document.getElementById('filter-category').value;
        const filterStatus = document.getElementById('filter-status').value;

        let filtered = products.filter(p => {
            const passCat = filterCat === 'all' || p.category === filterCat;
            const passStatus = filterStatus === 'all' || p.statusObj === filterStatus;
            return passCat && passStatus;
        });

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="py-12 text-center text-ios-textSub">
                    <i class="fa-solid fa-box-open text-4xl mb-3 opacity-30"></i>
                    <p>No hay productos que mostrar.</p>
                </div>`;
            return;
        }

        let html = '';
        filtered.forEach(p => {
            const daysMsg = p.daysRemaining > 0 ? `Vence en ${p.daysRemaining} días` : (p.daysRemaining === 0 ? 'Vence hoy' : 'Vencido');
            const dotColor = p.statusObj === 'danger' ? 'bg-status-danger' : p.statusObj === 'warning' ? 'bg-status-warning' : 'bg-status-safe';
            const dateColor = p.statusObj === 'danger' ? 'text-status-danger' : 'text-ios-textSub';

            html += `
            <div class="bg-white p-4 border-b border-ios-border flex items-center gap-4 transition hover:bg-ios-sec group">
                <div class="w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0 ${p.statusObj === 'danger' ? 'bg-red-50 text-status-danger' : p.statusObj === 'warning' ? 'bg-orange-50 text-status-warning' : 'bg-green-50 text-status-safe'}">
                    <i class="fa-solid fa-box text-xl"></i>
                </div>
                
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between mb-1">
                        <h3 class="font-bold text-ios-textTitle text-base truncate pr-2">${p.name}</h3>
                        <span class="text-[10px] font-semibold px-2 py-0.5 rounded border border-ios-border text-ios-textSub whitespace-nowrap">${p.category}</span>
                    </div>
                    <p class="text-xs font-medium ${dateColor} flex items-center">
                        <span class="inline-block w-2 h-2 rounded-full mr-1.5 ${dotColor}"></span>
                        ${daysMsg} <span class="text-gray-400 font-normal ml-1">· ${p.expiryDate}</span>
                    </p>
                </div>

                <div class="flex flex-col sm:flex-row gap-2 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button onclick="window.UI.processProduct(${p.id}, 'consumed')" class="w-8 h-8 rounded-full bg-ios-sec hover:bg-green-50 text-status-safe flex items-center justify-center transition" title="Consumí">
                        <i class="fa-solid fa-check"></i>
                    </button>
                    <button onclick="window.UI.processProduct(${p.id}, 'wasted')" class="w-8 h-8 rounded-full bg-ios-sec hover:bg-red-50 text-status-danger flex items-center justify-center transition" title="Tiré">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>`;
        });

        container.innerHTML = html;
    },

    renderHistory(history) {
        const container = document.getElementById('history-list');
        if (history.length === 0) {
            container.innerHTML = `
                <div class="py-12 text-center text-ios-textSub">
                    No hay registros en el historial.
                </div>`;
            return;
        }

        let html = '';
        history.forEach(h => {
            const statusChip = h.finalStatus === 'consumed'
                ? '<span class="text-status-safe text-xs font-semibold"><i class="fa-solid fa-check mr-1"></i>Consumido</span>'
                : '<span class="text-status-danger text-xs font-semibold"><i class="fa-solid fa-xmark mr-1"></i>Desperdicio</span>';

            const price = h.price ? `Q${h.price.toFixed(2)}` : '-';
            const lossColor = h.finalStatus === 'wasted' && h.price > 0 ? 'text-status-danger font-bold' : 'text-ios-textTitle';

            html += `
            <div class="px-6 py-4 flex items-center justify-between border-b border-ios-border hover:bg-ios-sec transition">
                <div class="flex-1 min-w-0 pr-4">
                    <p class="font-semibold text-ios-textTitle text-sm truncate">${h.name}</p>
                    <div class="flex items-center gap-2 mt-0.5">
                        ${statusChip}
                        <span class="text-[10px] text-ios-textSub">${new Date(h.dateRemoved).toLocaleDateString()}</span>
                    </div>
                </div>
                <div class="text-right shrink-0">
                    <span class="text-sm ${lossColor}">${price}</span>
                </div>
            </div>`;
        });
        container.innerHTML = html;
    },

    renderShoppingList(items) {
        const container = document.getElementById('shopping-list');
        const actions = document.getElementById('shopping-actions');

        if (items.length === 0) {
            container.innerHTML = `
                <div class="py-12 text-center text-ios-textSub">
                    <i class="fa-solid fa-basket-shopping text-4xl mb-3 opacity-30"></i>
                    <p>Tu lista de compras está vacía.</p>
                </div>`;
            if (actions) actions.classList.add('hidden');
            return;
        }

        let hasChecked = false;
        let html = '';
        items.forEach(item => {
            if (item.checked) hasChecked = true;
            const textClass = item.checked ? 'line-through text-ios-textSub' : 'text-ios-textTitle font-semibold';
            html += `
            <div class="px-6 py-4 flex items-center justify-between border-b border-ios-border hover:bg-ios-sec transition">
                <div class="flex items-center gap-3 flex-1">
                    <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="window.UI.toggleShopping(${item.id}, this.checked)" class="w-5 h-5 text-ios-black border-gray-300 rounded focus:ring-ios-black cursor-pointer">
                    <p class="text-sm ${textClass} truncate">${item.name}</p>
                </div>
            </div>`;
        });

        container.innerHTML = html;
        if (hasChecked && actions) {
            actions.classList.remove('hidden');
        } else if (actions) {
            actions.classList.add('hidden');
        }
    },

    async toggleShopping(id, checked) {
        await Logic.toggleShoppingItem(id, checked);
        const items = await Logic.getShoppingList();
        this.renderShoppingList(items);
    },

    updateCharts(categories, history) {
        // Grafico 1: Categorias (Pie)
        const ctxCat = document.getElementById('categoryChart');
        if (chartCategory) chartCategory.destroy();

        const catLabels = Object.keys(categories);
        const catData = Object.values(categories);

        // Colors palette
        const bgColors = ['#000000', '#34C759', '#FF9500', '#FF3B30', '#5856D6', '#AF52DE'];
        const textColor = '#8E8E93';

        chartCategory = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
                labels: catLabels.length ? catLabels : ['Vacío'],
                datasets: [{
                    data: catData.length ? catData : [1],
                    backgroundColor: catData.length ? bgColors : ['#E5E5EA'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: textColor, font: { family: 'Inter', weight: 500 } } }
                },
                cutout: '70%'
            }
        });

        // Grafico 2: Vencidos por mes
        const ctxExp = document.getElementById('expiredChart');
        if (chartExpired) chartExpired.destroy();

        // Agrupar por mes
        const wasted = history.filter(h => h.finalStatus === 'wasted');
        const monthsData = {};

        // Generar ultimos 6 meses
        const today = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const key = d.toLocaleString('es-ES', { month: 'short' }).toUpperCase();
            monthsData[key] = 0;
        }

        wasted.forEach(h => {
            const d = new Date(h.dateRemoved);
            const key = d.toLocaleString('es-ES', { month: 'short' }).toUpperCase();
            if (monthsData.hasOwnProperty(key)) {
                monthsData[key]++;
            }
        });

        chartExpired = new Chart(ctxExp, {
            type: 'bar',
            data: {
                labels: Object.keys(monthsData),
                datasets: [{
                    label: 'Productos Vencidos',
                    data: Object.values(monthsData),
                    backgroundColor: '#ef4444',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1, color: textColor }, grid: { color: '#E5E5EA' } },
                    x: { ticks: { color: textColor }, grid: { display: false } }
                }
            }
        });
    },

    // --- Actions ---
    async processProduct(id, finalStatus) {
        const title = finalStatus === 'consumed' ? '¿Consumiste este producto?' : '¿Reportar como desperdicio?';
        const confirmColor = finalStatus === 'consumed' ? '#10b981' : '#ef4444';
        const icon = finalStatus === 'consumed' ? 'success' : 'warning';
        const text = finalStatus === 'wasted' ? 'El valor del producto se sumará a tus pérdidas estimadas.' : '';

        const result = await Swal.fire({
            title: title,
            html: `
                <p class="text-sm text-ios-textSub mb-4">${text}</p>
                <div class="flex items-center justify-center mt-2">
                    <input type="checkbox" id="add-to-shopping" checked class="w-5 h-5 text-ios-black border-gray-300 rounded focus:ring-ios-black cursor-pointer">
                    <label for="add-to-shopping" class="ml-2 text-sm font-medium text-ios-textTitle cursor-pointer">¿Agregar a la lista de compras?</label>
                </div>
            `,
            icon: icon,
            showCancelButton: true,
            confirmButtonColor: confirmColor,
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Sí, confirmar',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const addToList = document.getElementById('add-to-shopping').checked;
                return { addToList };
            }
        });

        if (result.isConfirmed) {
            const product = await db.get(STORE_PRODUCTS, id);
            await Logic.moveToHistory(id, finalStatus);

            if (result.value.addToList && product) {
                await Logic.addToShoppingList(product.name);
            }

            Swal.fire({
                title: 'Actualizado!',
                text: 'El inventario ha sido actualizado.',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });
            await UI.refreshAll();
        }
    },

    quickAction(id, action) {
        this.processProduct(id, action);
    },

    async generateRecipePrompt() {
        const products = await Logic.loadActiveInventory();
        const alerts = products.filter(p => p.statusObj === 'danger' || p.statusObj === 'warning').map(p => p.name);
        const safe = products.filter(p => p.statusObj === 'safe').map(p => p.name);

        if (products.length === 0) {
            Swal.fire('Inventario Vacío', 'Agrega productos primero para obtener sugerencias.', 'info');
            return;
        }

        let pt = "Tengo estos ingredientes en mi inventario:\\n\\n";
        if (alerts.length > 0) pt += "Por vencer / Urgentes:\\n- " + alerts.join("\\n- ") + "\\n\\n";
        pt += "Otros ingredientes:\\n- " + (safe.length > 0 ? safe.join("\\n- ") : "Ninguno") + "\\n\\n";
        pt += "¿Qué receta puedo cocinar hoy para aprovechar especialmente los urgentes?";

        Swal.fire({
            title: 'Sugerencia de Chef',
            html: `
                <div class="text-left bg-ios-sec p-4 rounded-xl text-sm text-ios-textTitle mb-4 max-h-48 overflow-y-auto whitespace-pre-wrap">${pt}</div>
                <p class="text-xs text-ios-textSub">Copia este texto y pégalo en ChatGPT para obtener ideas increíbles.</p>
            `,
            icon: 'info',
            showCancelButton: true,
            confirmButtonText: '<i class="fa-solid fa-copy"></i> Copiar',
            cancelButtonText: '<i class="fa-solid fa-up-right-from-square"></i> Abrir ChatGPT',
            cancelButtonColor: '#10b981',
            confirmButtonColor: '#000000',
        }).then((result) => {
            if (result.isConfirmed) {
                navigator.clipboard.writeText(pt).then(() => {
                    Swal.fire({ title: '¡Copiado!', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
                });
            } else if (result.dismiss === Swal.DismissReason.cancel) {
                navigator.clipboard.writeText(pt).then(() => {
                    window.open('https://chatgpt.com/', '_blank');
                });
            }
        });
    },

    // --- Modal Navigation ---
    toggleModal(modalId, show) {
        const modal = document.getElementById(modalId);
        const panel = modal.querySelector('#modal-panel');
        if (show) {
            modal.classList.remove('hidden');
            // Trigger reflow
            void modal.offsetWidth;
            modal.classList.remove('opacity-0');
            modal.classList.add('opacity-100');
            if (panel) panel.classList.remove('translate-y-full');
        } else {
            modal.classList.remove('opacity-100');
            modal.classList.add('opacity-0');
            if (panel) panel.classList.add('translate-y-full');
            setTimeout(() => modal.classList.add('hidden'), 300);
        }
    },

    navigate(targetId) {
        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.add('hidden');
            el.classList.remove('block');
        });

        const target = document.getElementById(targetId);
        target.classList.remove('hidden');
        target.classList.add('block');

        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[data-target="${targetId}"]`).classList.add('active');

        currentView = targetId;
        window.scrollTo(0, 0);
    }
};

window.UI = UI; // Expose for inline onclick handlers

// ==========================================
// 5. ESCÁNER DE CÓDIGO DE BARRAS
// ==========================================
const Scanner = {
    init() {
        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("reader");
        }
    },

    start() {
        this.init();
        UI.toggleModal('modal-scanner', true);

        const config = { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.0 };

        html5QrCode.start(
            { facingMode: "environment" },
            config,
            (decodedText, decodedResult) => {
                // Success
                this.stop();
                document.getElementById('prod-barcode').value = decodedText;

                // Fetch de OpenFoodFacts
                if (window.API) window.API.fetchProduct(decodedText);
            },
            (errorMessage) => {
                // Ignore errors (scanning empty frames)
            }
        ).catch(err => {
            console.error(err);
            UI.toggleModal('modal-scanner', false);
            Swal.fire('Error', 'No se pudo acceder a la cámara. Revisa los permisos.', 'error');
        });
    },

    stop() {
        if (html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop().then(() => {
                UI.toggleModal('modal-scanner', false);
            }).catch(err => console.error(err));
        } else {
            UI.toggleModal('modal-scanner', false);
        }
    }
};

// ==========================================
// 6. EXPORTAR E IMPORTAR (Excel)
// ==========================================
const DataSync = {
    async exportToExcel() {
        try {
            const products = await db.getAll(STORE_PRODUCTS);
            const history = await db.getAll(STORE_HISTORY);

            // Format Data
            const wsProducts = XLSX.utils.json_to_sheet(products.map(p => ({
                ID: p.id,
                Código: p.barcode || '',
                Nombre: p.name,
                Categoría: p.category,
                Precio: p.price,
                Vencimiento: p.expiryDate,
                Agregado: p.dateAdded
            })));

            const wsHistory = XLSX.utils.json_to_sheet(history.map(h => ({
                ID: h.id,
                Código: h.barcode || '',
                Nombre: h.name,
                Categoría: h.category,
                Precio: h.price,
                Resultado: h.finalStatus === 'consumed' ? 'Consumido' : 'Desperdicio',
                FechaSalida: h.dateRemoved
            })));

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, wsProducts, "Inventario Activo");
            XLSX.utils.book_append_sheet(wb, wsHistory, "Historial");

            XLSX.writeFile(wb, `Inventario_${new Date().toISOString().split('T')[0]}.xlsx`);

            Swal.fire('Exportado', 'El archivo Excel se ha descargado.', 'success');
        } catch (e) {
            Swal.fire('Error', 'No se pudo exportar: ' + e.message, 'error');
        }
    },

    // Importar requiere que el usuario escoja un archivo compatible
    async importFromExcel(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                // Read primera hoja (Inventario)
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const json = XLSX.utils.sheet_to_json(worksheet);

                if (json.length === 0) return Swal.fire('Error', 'El archivo está vacío.', 'error');

                let count = 0;
                for (let row of json) {
                    if (row.Nombre && row.Vencimiento) {
                        await Logic.addProduct({
                            barcode: row.Código?.toString() || '',
                            name: row.Nombre,
                            category: row.Categoría || 'Otros',
                            price: parseFloat(row.Precio) || 0,
                            expiryDate: row.Vencimiento
                        });
                        count++;
                    }
                }

                Swal.fire('Importación Exitosa', `Se importaron ${count} productos.`, 'success');
            } catch (err) {
                Swal.fire('Error', 'Error al leer el archivo. Asegúrate de que tenga el formato correcto.', 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    }
};

// ==========================================
// 7. INICIALIZACIÓN Y EVENT LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {

    const toggleMenu = (show) => {
        const sideMenu = document.getElementById('side-menu');
        const sideMenuPanel = document.getElementById('side-menu-panel');
        if (show) {
            sideMenu.classList.remove('hidden');
            void sideMenu.offsetWidth;
            sideMenu.classList.remove('opacity-0');
            sideMenuPanel.classList.remove('-translate-x-full');
        } else {
            sideMenu.classList.remove('opacity-100');
            sideMenu.classList.add('opacity-0');
            sideMenuPanel.classList.add('-translate-x-full');
            setTimeout(() => sideMenu.classList.add('hidden'), 300);
        }
    };

    document.getElementById('btn-menu-toggle')?.addEventListener('click', () => toggleMenu(true));
    document.getElementById('side-menu-bg')?.addEventListener('click', () => toggleMenu(false));

    // DB Init
    try {
        await db.init();
        await UI.refreshAll();
    } catch (e) {
        console.error('Error DB:', e);
        Swal.fire('Error Crítico', 'No se pudo iniciar la Base de Datos Local.', 'error');
    }

    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const target = btn.getAttribute('data-target');
            document.querySelectorAll('.nav-btn').forEach(b => {
                b.classList.remove('active', 'text-ios-black');
                b.classList.add('text-ios-textTitle');
            });
            btn.classList.add('active', 'text-ios-black');
            UI.navigate(target);
            toggleMenu(false);

            // Fix heading text
            const titleMap = {
                'view-dashboard': 'Inventario',
                'view-inventory': 'Lista',
                'view-history': 'Historial',
                'view-shopping': 'Compras',
                'view-about': 'Acerca de'
            };
            document.querySelector('header h1').innerText = titleMap[target] || 'Inventario';
        });
    });

    // Modals & Form
    document.getElementById('btn-add').addEventListener('click', () => {
        document.getElementById('product-form').reset();
        document.getElementById('prod-id').value = '';
        // Set default date to 1 week from now
        const d = new Date();
        d.setDate(d.getDate() + 7);
        document.getElementById('prod-date').value = d.toISOString().split('T')[0];

        UI.toggleModal('modal-add', true);
    });

    document.getElementById('btn-close-modal').addEventListener('click', () => {
        UI.toggleModal('modal-add', false);
    });

    document.getElementById('modal-bg').addEventListener('click', () => {
        UI.toggleModal('modal-add', false);
    });

    document.getElementById('product-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const data = {
            barcode: document.getElementById('prod-barcode').value.trim(),
            name: document.getElementById('prod-name').value.trim(),
            category: document.getElementById('prod-category').value,
            price: document.getElementById('prod-price').value,
            expiryDate: document.getElementById('prod-date').value
        };

        const id = document.getElementById('prod-id').value;

        if (id) {
            // Update mode no implementado en detalle aún, insertamos nuevo por ahora si id estaba vacío
        } else {
            await Logic.addProduct(data);
            Swal.fire({
                title: 'Guardado',
                text: 'Producto agregado exitosamente',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });
        }

        UI.toggleModal('modal-add', false);
    });

    // Filtros
    document.getElementById('filter-category').addEventListener('change', async () => {
        const prod = await Logic.loadActiveInventory();
        UI.renderInventory(prod);
    });
    document.getElementById('filter-status').addEventListener('change', async () => {
        const prod = await Logic.loadActiveInventory();
        UI.renderInventory(prod);
    });

    // Scanner
    document.getElementById('btn-scan').addEventListener('click', () => {
        Scanner.start();
    });
    document.getElementById('btn-close-scanner').addEventListener('click', () => {
        Scanner.stop();
    });

    // Excel
    document.getElementById('btn-export-excel')?.addEventListener('click', () => {
        DataSync.exportToExcel();
    });

    // Autocompletado manual de codigo de barras
    document.getElementById('prod-barcode')?.addEventListener('blur', (e) => {
        if (window.API) window.API.fetchProduct(e.target.value.trim());
    });

    // Boton borrar comprados
    document.getElementById('btn-clear-shopping')?.addEventListener('click', async () => {
        await Logic.clearCheckedShopping();
        UI.refreshAll();
    });

    // Boton Gourmet
    document.getElementById('btn-gourmet')?.addEventListener('click', () => {
        UI.generateRecipePrompt();
    });

    const fileInput = document.getElementById('excel-file-input');
    document.getElementById('btn-import-excel')?.addEventListener('click', () => {
        if (fileInput) fileInput.click();
    });
    fileInput?.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            DataSync.importFromExcel(e.target.files[0]);
        }
        e.target.value = ''; // Reset
    });
});

// ==========================================
// 8. OPENFOODFACTS API
// ==========================================
window.API = {
    async fetchProduct(barcode) {
        if (!barcode) return;
        try {
            const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
            const data = await res.json();
            if (data.status === 1) {
                const p = data.product;
                document.getElementById('prod-name').value = p.product_name_es || p.product_name || '';

                const brandInput = document.getElementById('prod-brand');
                if (brandInput && p.brands) brandInput.value = p.brands.split(',')[0];

                // Intentar mapear categoria
                let cat = 'Otros';
                const hierarchy = p.categories_hierarchy || [];
                const catStr = hierarchy.join(' ').toLowerCase();
                if (catStr.includes('milk') || catStr.includes('cheese') || catStr.includes('dairy') || catStr.includes('lácteos') || catStr.includes('quesos')) cat = 'Lácteos';
                else if (catStr.includes('meat') || catStr.includes('carnes')) cat = 'Carnes';
                else if (catStr.includes('plant-based') || catStr.includes('vegetable') || catStr.includes('verduras') || catStr.includes('vegetales')) cat = 'Verduras';
                else if (catStr.includes('beverage') || catStr.includes('bebidas') || catStr.includes('drinks')) cat = 'Bebidas';

                document.getElementById('prod-category').value = cat;

                Swal.fire({
                    title: 'Producto Encontrado',
                    text: p.product_name_es || p.product_name,
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false,
                    toast: true,
                    position: 'top-end'
                });
            }
        } catch (e) {
            console.warn("OpenFoodFacts offline o error:", e);
        }
    }
};

// Registrar Service Worker para PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW Registrado', reg.scope))
            .catch(err => console.log('Error registro SW', err));
    });
}
