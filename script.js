/**
 * Gestión de Inventario Doméstico — v3.0 Profesional
 * PWA + Vanilla JS + IndexedDB + OpenFoodFacts
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
let currentView = 'view-dashboard';
let _barcodeDebounce = null;

// ==========================================
// 2. UTILIDADES
// ==========================================
const Utils = {
    // Animated counter for stat numbers
    animateCounter(element, target, duration = 600) {
        const start = parseInt(element.innerText) || 0;
        if (start === target) return;

        const startTime = performance.now();
        const diff = target - start;

        const step = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // easeOutExpo
            const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
            const current = Math.round(start + diff * eased);
            element.innerText = current;

            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                element.classList.add('animate-stat-pop');
                setTimeout(() => element.classList.remove('animate-stat-pop'), 600);
            }
        };

        requestAnimationFrame(step);
    },

    // Debounce helper
    debounce(fn, ms) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    },

    // Haptic feedback (if supported)
    haptic(style = 'light') {
        if (navigator.vibrate) {
            const patterns = { light: 10, medium: 25, heavy: 50, success: [10, 50, 10] };
            navigator.vibrate(patterns[style] || 10);
        }
    },

    // Escape HTML
    escapeHtml(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }
};

// ==========================================
// 3. BASE DE DATOS LOCAL (IndexedDB)
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

                if (!database.objectStoreNames.contains(STORE_PRODUCTS)) {
                    database.createObjectStore(STORE_PRODUCTS, { keyPath: 'id', autoIncrement: true });
                }
                if (!database.objectStoreNames.contains(STORE_HISTORY)) {
                    database.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true });
                }
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
// 4. LÓGICA DE NEGOCIO
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
            finalStatus: finalStatus,
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
// 5. INTERFAZ DE USUARIO (UI)
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
        let safe = 0, warning = 0, danger = 0;
        let categories = {};

        products.forEach(p => {
            if (p.statusObj === 'safe') safe++;
            else if (p.statusObj === 'warning') warning++;
            else if (p.statusObj === 'danger') danger++;

            categories[p.category] = (categories[p.category] || 0) + 1;
        });

        // Animated counters
        Utils.animateCounter(document.getElementById('stat-total'), products.length);
        Utils.animateCounter(document.getElementById('stat-safe'), safe);
        Utils.animateCounter(document.getElementById('stat-warning'), warning);
        Utils.animateCounter(document.getElementById('stat-danger'), danger);

        // Pérdida Económica
        const loss = history
            .filter(h => h.finalStatus === 'wasted')
            .reduce((sum, h) => sum + (h.price || 0), 0);
        document.getElementById('stat-loss').innerText = `Q${loss.toFixed(2)}`;

        this.updateCharts(categories, history);
    },

    checkAlerts(products) {
        const container = document.getElementById('alerts-container');
        const alerts = products.filter(p => p.statusObj === 'warning' || p.statusObj === 'danger');

        if (alerts.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 px-4">
                    <div class="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <i class="fa-solid fa-shield-check text-2xl text-status-safe"></i>
                    </div>
                    <p class="text-sm font-semibold text-ios-textTitle">Todo en orden</p>
                    <p class="text-xs text-ios-textSub mt-1">Tu inventario está en excelentes condiciones.</p>
                </div>`;
            return;
        }

        let html = '<div class="divide-y divide-ios-border/50">';
        alerts.slice(0, 5).forEach((p, i) => {
            const icon = p.statusObj === 'danger' ? 'fa-triangle-exclamation text-status-danger' : 'fa-clock text-status-warning';
            const bgIcon = p.statusObj === 'danger' ? 'bg-red-50' : 'bg-orange-50';
            const textClass = p.statusObj === 'danger' ? 'text-status-danger font-bold' : 'text-status-warning font-semibold';
            const daysText = p.daysRemaining < 0
                ? `Vencido hace ${Math.abs(p.daysRemaining)} días`
                : (p.daysRemaining === 0 ? 'Vence hoy' : `Vence en ${p.daysRemaining} días`);
            const escapedName = Utils.escapeHtml(p.name);

            html += `
            <div class="px-4 py-3.5 flex items-center gap-3 hover:bg-white/50 transition animate-card-in" style="animation-delay: ${i * 60}ms">
                <div class="w-10 h-10 ${bgIcon} rounded-xl flex items-center justify-center shrink-0">
                    <i class="fa-solid ${icon} text-base"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-bold text-ios-textTitle truncate">${escapedName}</p>
                    <p class="text-xs ${textClass}">${daysText}</p>
                </div>
                <button onclick="window.UI.quickAction(${p.id}, 'consumed')" class="text-[11px] bg-ios-black text-white px-3 py-1.5 rounded-full hover:opacity-80 active:scale-95 transition-all font-bold">Consumir</button>
            </div>`;
        });
        html += '</div>';

        container.innerHTML = html;

        // Notificaciones PWA
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
                <div class="py-16 text-center">
                    <div class="empty-state-icon inline-block mb-4">
                        <div class="w-16 h-16 bg-ios-sec rounded-2xl flex items-center justify-center mx-auto">
                            <i class="fa-solid fa-box-open text-3xl text-ios-border"></i>
                        </div>
                    </div>
                    <p class="text-sm font-semibold text-ios-textSub">No hay productos que mostrar</p>
                    <p class="text-xs text-ios-textSub/70 mt-1">Agrega productos con el botón +</p>
                </div>`;
            return;
        }

        let html = '';
        filtered.forEach((p, i) => {
            const daysMsg = p.daysRemaining > 0
                ? `Vence en ${p.daysRemaining} día${p.daysRemaining > 1 ? 's' : ''}`
                : (p.daysRemaining === 0 ? 'Vence hoy' : `Vencido hace ${Math.abs(p.daysRemaining)} día${Math.abs(p.daysRemaining) > 1 ? 's' : ''}`);
            const dotColor = p.statusObj === 'danger' ? 'bg-status-danger' : p.statusObj === 'warning' ? 'bg-status-warning' : 'bg-status-safe';
            const dateColor = p.statusObj === 'danger' ? 'text-status-danger' : 'text-ios-textSub';
            const iconBg = p.statusObj === 'danger' ? 'bg-red-50 text-status-danger' : p.statusObj === 'warning' ? 'bg-orange-50 text-status-warning' : 'bg-green-50 text-status-safe';
            const escapedName = Utils.escapeHtml(p.name);
            const escapedCat = Utils.escapeHtml(p.category);
            const priceStr = p.price > 0 ? `Q${p.price.toFixed(2)}` : '';

            html += `
            <div class="inventory-item bg-white p-4 rounded-2xl border border-ios-border/30 flex items-center gap-4 group animate-card-in shadow-sm hover:shadow-md" style="animation-delay: ${Math.min(i * 40, 400)}ms">
                <div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${iconBg}">
                    <i class="fa-solid fa-box text-lg"></i>
                </div>
                
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between mb-0.5">
                        <h3 class="font-bold text-ios-textTitle text-[15px] truncate pr-2">${escapedName}</h3>
                        <span class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-ios-sec text-ios-textSub whitespace-nowrap uppercase tracking-wider">${escapedCat}</span>
                    </div>
                    <div class="flex items-center justify-between">
                        <p class="text-xs font-medium ${dateColor} flex items-center">
                            <span class="inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${dotColor}"></span>
                            ${daysMsg}
                        </p>
                        ${priceStr ? `<span class="text-[11px] font-semibold text-ios-textSub">${priceStr}</span>` : ''}
                    </div>
                </div>

                <div class="flex flex-col gap-1.5 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button onclick="window.UI.processProduct(${p.id}, 'consumed')" class="w-8 h-8 rounded-full bg-green-50 hover:bg-green-100 text-status-safe flex items-center justify-center transition active:scale-90" title="Consumí">
                        <i class="fa-solid fa-check text-sm"></i>
                    </button>
                    <button onclick="window.UI.processProduct(${p.id}, 'wasted')" class="w-8 h-8 rounded-full bg-red-50 hover:bg-red-100 text-status-danger flex items-center justify-center transition active:scale-90" title="Tiré">
                        <i class="fa-solid fa-trash-can text-sm"></i>
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
                <div class="py-16 text-center">
                    <div class="empty-state-icon inline-block mb-4">
                        <div class="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto">
                            <i class="fa-solid fa-clock-rotate-left text-3xl text-ios-border"></i>
                        </div>
                    </div>
                    <p class="text-sm font-semibold text-ios-textSub">No hay registros en el historial</p>
                </div>`;
            return;
        }

        let html = '<div class="divide-y divide-ios-border/30">';
        history.forEach((h, i) => {
            const statusChip = h.finalStatus === 'consumed'
                ? '<span class="inline-flex items-center gap-1 text-status-safe text-[11px] font-bold bg-green-50 px-2 py-0.5 rounded-full"><i class="fa-solid fa-check"></i>Consumido</span>'
                : '<span class="inline-flex items-center gap-1 text-status-danger text-[11px] font-bold bg-red-50 px-2 py-0.5 rounded-full"><i class="fa-solid fa-xmark"></i>Desperdicio</span>';

            const price = h.price ? `Q${h.price.toFixed(2)}` : '-';
            const lossColor = h.finalStatus === 'wasted' && h.price > 0 ? 'text-status-danger font-black' : 'text-ios-textTitle font-semibold';
            const escapedName = Utils.escapeHtml(h.name);

            html += `
            <div class="px-5 py-4 flex items-center justify-between hover:bg-white/50 transition animate-card-in" style="animation-delay: ${Math.min(i * 30, 300)}ms">
                <div class="flex-1 min-w-0 pr-4">
                    <p class="font-bold text-ios-textTitle text-sm truncate">${escapedName}</p>
                    <div class="flex items-center gap-2 mt-1">
                        ${statusChip}
                        <span class="text-[10px] text-ios-textSub font-medium">${new Date(h.dateRemoved).toLocaleDateString()}</span>
                    </div>
                </div>
                <div class="text-right shrink-0">
                    <span class="text-sm ${lossColor}">${price}</span>
                </div>
            </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
    },

    renderShoppingList(items) {
        const container = document.getElementById('shopping-list');
        const actions = document.getElementById('shopping-actions');

        if (items.length === 0) {
            container.innerHTML = `
                <div class="py-16 text-center">
                    <div class="empty-state-icon inline-block mb-4">
                        <div class="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto">
                            <i class="fa-solid fa-basket-shopping text-3xl text-ios-border"></i>
                        </div>
                    </div>
                    <p class="text-sm font-semibold text-ios-textSub">Tu lista de compras está vacía</p>
                    <p class="text-xs text-ios-textSub/70 mt-1">Los productos se agregan automáticamente</p>
                </div>`;
            if (actions) actions.classList.add('hidden');
            return;
        }

        let hasChecked = false;
        let html = '<div class="divide-y divide-ios-border/30">';
        items.forEach(item => {
            if (item.checked) hasChecked = true;
            const textClass = item.checked ? 'line-through text-ios-textSub' : 'text-ios-textTitle font-bold';
            const escapedName = Utils.escapeHtml(item.name);
            html += `
            <div class="px-5 py-4 flex items-center justify-between hover:bg-white/50 transition">
                <div class="flex items-center gap-3 flex-1">
                    <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="window.UI.toggleShopping(${item.id}, this.checked)" class="w-5 h-5 text-ios-black border-gray-300 rounded-lg focus:ring-ios-black cursor-pointer accent-black">
                    <p class="text-sm ${textClass} truncate">${escapedName}</p>
                </div>
            </div>`;
        });
        html += '</div>';

        container.innerHTML = html;
        if (hasChecked && actions) {
            actions.classList.remove('hidden');
        } else if (actions) {
            actions.classList.add('hidden');
        }
    },

    async toggleShopping(id, checked) {
        Utils.haptic('light');
        await Logic.toggleShoppingItem(id, checked);
        const items = await Logic.getShoppingList();
        this.renderShoppingList(items);
    },

    updateCharts(categories, history) {
        const ctxCat = document.getElementById('categoryChart');
        if (chartCategory) chartCategory.destroy();

        const catLabels = Object.keys(categories);
        const catData = Object.values(categories);

        const bgColors = ['#111111', '#34C759', '#FF9500', '#FF3B30', '#5856D6', '#AF52DE', '#007AFF', '#FF2D55'];
        const textColor = '#8E8E93';

        chartCategory = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
                labels: catLabels.length ? catLabels : ['Vacío'],
                datasets: [{
                    data: catData.length ? catData : [1],
                    backgroundColor: catData.length ? bgColors : ['#E5E5EA'],
                    borderWidth: 0,
                    hoverOffset: 6,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: textColor,
                            font: { family: 'Inter', weight: '600', size: 11 },
                            padding: 16,
                            usePointStyle: true,
                            pointStyle: 'rectRounded'
                        }
                    }
                },
                cutout: '72%',
                animation: {
                    animateRotate: true,
                    duration: 800,
                    easing: 'easeOutQuart'
                }
            }
        });

        // Grafico 2: Vencidos por mes
        const ctxExp = document.getElementById('expiredChart');
        if (chartExpired) chartExpired.destroy();

        const wasted = history.filter(h => h.finalStatus === 'wasted');
        const monthsData = {};

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
                    backgroundColor: '#FF3B30',
                    borderRadius: 8,
                    borderSkipped: false,
                    barThickness: 28
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, color: textColor, font: { family: 'Inter', weight: '600', size: 10 } },
                        grid: { color: '#F0F0F0', drawBorder: false }
                    },
                    x: {
                        ticks: { color: textColor, font: { family: 'Inter', weight: '600', size: 10 } },
                        grid: { display: false }
                    }
                },
                animation: {
                    duration: 800,
                    easing: 'easeOutQuart'
                }
            }
        });
    },

    // --- Actions ---
    async processProduct(id, finalStatus) {
        Utils.haptic('medium');
        const title = finalStatus === 'consumed' ? '¿Consumiste este producto?' : '¿Reportar como desperdicio?';
        const confirmColor = finalStatus === 'consumed' ? '#34C759' : '#FF3B30';
        const icon = finalStatus === 'consumed' ? 'success' : 'warning';
        const text = finalStatus === 'wasted' ? 'El valor del producto se sumará a tus pérdidas estimadas.' : '';

        const result = await Swal.fire({
            title: title,
            html: `
                <p class="text-sm text-ios-textSub mb-4">${text}</p>
                <div class="flex items-center justify-center mt-2">
                    <input type="checkbox" id="add-to-shopping" checked class="w-5 h-5 text-ios-black border-gray-300 rounded-lg focus:ring-ios-black cursor-pointer accent-black">
                    <label for="add-to-shopping" class="ml-2 text-sm font-semibold text-ios-textTitle cursor-pointer">¿Agregar a la lista de compras?</label>
                </div>
            `,
            icon: icon,
            showCancelButton: true,
            confirmButtonColor: confirmColor,
            cancelButtonColor: '#8E8E93',
            confirmButtonText: 'Sí, confirmar',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const addToList = document.getElementById('add-to-shopping').checked;
                return { addToList };
            }
        });

        if (result.isConfirmed) {
            Utils.haptic('success');
            const product = await db.get(STORE_PRODUCTS, id);
            await Logic.moveToHistory(id, finalStatus);

            if (result.value.addToList && product) {
                await Logic.addToShoppingList(product.name);
            }

            Swal.fire({
                title: '¡Actualizado!',
                text: 'El inventario ha sido actualizado.',
                icon: 'success',
                timer: 1200,
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
            title: '🍳 Chef Inteligente',
            html: `
                <div class="text-left bg-gray-50 p-4 rounded-2xl text-sm text-ios-textTitle mb-4 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-xs">${pt}</div>
                <p class="text-xs text-ios-textSub font-medium">Copia este texto y pégalo en ChatGPT para obtener ideas increíbles.</p>
            `,
            icon: 'info',
            showCancelButton: true,
            confirmButtonText: '<i class="fa-solid fa-copy"></i> Copiar',
            cancelButtonText: '<i class="fa-solid fa-up-right-from-square"></i> Abrir ChatGPT',
            cancelButtonColor: '#34C759',
            confirmButtonColor: '#000000',
        }).then((result) => {
            if (result.isConfirmed) {
                navigator.clipboard.writeText(pt).then(() => {
                    Swal.fire({ title: '¡Copiado!', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1200 });
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
        const activeBtn = document.querySelector(`[data-target="${targetId}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        currentView = targetId;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

window.UI = UI;

// ==========================================
// 6. ESCÁNER DE CÓDIGO DE BARRAS — Enhanced
// ==========================================
const Scanner = {
    _audioCtx: null,

    init() {
        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("reader");
        }
    },

    /** Generate a beep sound using Web Audio API */
    playBeep() {
        try {
            if (!this._audioCtx) {
                this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            const ctx = this._audioCtx;

            // Main beep tone
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.setValueAtTime(660, ctx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);

            // Second beep (double-beep effect like supermarket scanners)
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2);
            gain2.connect(ctx.destination);

            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.18);
            gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.18);
            gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.30);

            osc2.start(ctx.currentTime + 0.18);
            osc2.stop(ctx.currentTime + 0.30);
        } catch (e) {
            console.warn('Audio not supported:', e);
        }
    },

    start() {
        this.init();
        Utils.haptic('medium');

        // Reset processing overlay
        this._resetOverlay();

        UI.toggleModal('modal-scanner', true);

        const config = { fps: 15, qrbox: { width: 250, height: 150 }, aspectRatio: 1.0 };

        html5QrCode.start(
            { facingMode: "environment" },
            config,
            (decodedText, decodedResult) => {
                // Immediately play beep and trigger haptic
                this.playBeep();
                Utils.haptic('success');

                // Flash the scanner frame green
                const frame = document.querySelector('.scanner-frame');
                if (frame) frame.classList.add('detected');

                // Stop camera but keep modal open for processing animation
                if (html5QrCode && html5QrCode.isScanning) {
                    html5QrCode.stop().catch(err => console.error(err));
                }

                // Start the staged processing flow
                this._runProcessingFlow(decodedText);
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

    /** Staged processing animation flow */
    async _runProcessingFlow(barcode) {
        const overlay = document.getElementById('scan-processing-overlay');
        const statusText = document.getElementById('scan-status-text');
        const statusIcon = document.getElementById('scan-status-icon');
        const progressFill = document.getElementById('scan-progress-fill');
        const resultCard = document.getElementById('scan-result-card');
        const resultImage = document.getElementById('scan-result-image');
        const resultName = document.getElementById('scan-result-name');
        const resultBrand = document.getElementById('scan-result-brand');

        // Show the overlay
        overlay.classList.remove('hidden');

        // STAGE 1: "Detectando código…" (800ms)
        statusText.textContent = 'Detectando código…';
        statusIcon.innerHTML = '<i class="fa-solid fa-barcode text-4xl text-white"></i>';
        statusIcon.className = 'scan-status-icon';
        progressFill.style.width = '30%';
        progressFill.className = 'scan-progress-fill';

        await this._delay(800);

        // STAGE 2: "Buscando producto…" (API call)
        statusText.textContent = 'Buscando producto…';
        statusIcon.innerHTML = '<i class="fa-solid fa-magnifying-glass text-4xl text-white fa-beat-fade"></i>';
        progressFill.style.width = '60%';

        // Fetch product data from API
        const productData = await BarcodeAPI.lookupAsync(barcode);

        if (productData && productData.name) {
            // STAGE 3 — SUCCESS
            progressFill.style.width = '100%';
            statusText.textContent = '¡Producto encontrado!';
            statusIcon.innerHTML = '<i class="fa-solid fa-circle-check text-4xl text-status-safe"></i>';
            statusIcon.className = 'scan-status-icon success';

            // Show the result card
            resultName.textContent = productData.name;
            resultBrand.textContent = productData.brand || '';

            if (productData.imageUrl) {
                resultImage.src = productData.imageUrl;
                resultImage.classList.remove('hidden');
            } else {
                resultImage.classList.add('hidden');
            }
            resultCard.className = 'scan-result-card';

            // Apply data to form
            document.getElementById('prod-barcode').value = barcode;
            BarcodeAPI._applyData(productData);

            // Wait for user to see the result
            await this._delay(1800);
        } else {
            // STAGE 3 — ERROR
            progressFill.style.width = '100%';
            progressFill.classList.add('error');
            statusText.textContent = 'Producto no encontrado';
            statusIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-4xl text-status-danger"></i>';
            statusIcon.className = 'scan-status-icon error';

            // Show error card
            resultName.textContent = 'Producto no encontrado';
            resultBrand.textContent = 'Intente escanear nuevamente o ingrese los datos manualmente.';
            resultImage.classList.add('hidden');
            resultCard.className = 'scan-result-card error';

            // Still set the barcode
            document.getElementById('prod-barcode').value = barcode;

            await this._delay(2000);
        }

        // Close scanner modal
        this._resetOverlay();
        UI.toggleModal('modal-scanner', false);

        // Reset scanner frame
        const frame = document.querySelector('.scanner-frame');
        if (frame) frame.classList.remove('detected');
    },

    _resetOverlay() {
        const overlay = document.getElementById('scan-processing-overlay');
        const progressFill = document.getElementById('scan-progress-fill');
        const resultCard = document.getElementById('scan-result-card');
        const resultImage = document.getElementById('scan-result-image');
        const statusIcon = document.getElementById('scan-status-icon');

        if (overlay) overlay.classList.add('hidden');
        if (progressFill) {
            progressFill.style.width = '0%';
            progressFill.className = 'scan-progress-fill';
        }
        if (resultCard) resultCard.classList.add('hidden');
        if (resultImage) resultImage.classList.add('hidden');
        if (statusIcon) statusIcon.className = 'scan-status-icon';
    },

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    stop() {
        this._resetOverlay();
        const frame = document.querySelector('.scanner-frame');
        if (frame) frame.classList.remove('detected');

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
// 7. BARCODE API (OpenFoodFacts) — Enhanced
// ==========================================
const BarcodeAPI = {
    _cache: new Map(),

    showLoading(show) {
        const status = document.getElementById('barcode-status');
        const wrapper = document.getElementById('barcode-field-wrapper');
        if (show) {
            status?.classList.remove('hidden');
            wrapper?.classList.add('barcode-loading');
        } else {
            status?.classList.add('hidden');
            wrapper?.classList.remove('barcode-loading');
        }
    },

    /** Returns product data or null (used by Scanner processing flow) */
    async lookupAsync(barcode) {
        if (!barcode || barcode.length < 4) return null;

        // Check cache first
        if (this._cache.has(barcode)) {
            return this._cache.get(barcode);
        }

        try {
            const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
            const data = await res.json();

            if (data.status === 1 && data.product) {
                const p = data.product;
                const productData = {
                    name: p.product_name_es || p.product_name || '',
                    brand: p.brands ? p.brands.split(',')[0].trim() : '',
                    category: this._mapCategory(p.categories_hierarchy || []),
                    imageUrl: p.image_front_small_url || p.image_front_url || null
                };

                this._cache.set(barcode, productData);
                return productData;
            }
            return null;
        } catch (e) {
            console.warn("OpenFoodFacts offline o error:", e);
            return null;
        }
    },

    /** Legacy lookup for manual barcode input — keeps the loading indicator behavior */
    async lookup(barcode) {
        if (!barcode || barcode.length < 4) return;

        if (this._cache.has(barcode)) {
            this._applyData(this._cache.get(barcode));
            return;
        }

        this.showLoading(true);

        const productData = await this.lookupAsync(barcode);

        if (productData && productData.name) {
            this._applyData(productData);
        } else {
            this.showLoading(false);
            // Show error toast for manual input
            Swal.fire({
                title: '❌ Producto no encontrado',
                text: 'Intente escanear nuevamente o ingrese los datos manualmente.',
                icon: 'warning',
                timer: 2500,
                showConfirmButton: false,
                toast: true,
                position: 'top-end'
            });
        }
    },

    _applyData(data) {
        this.showLoading(false);

        const nameInput = document.getElementById('prod-name');
        const brandInput = document.getElementById('prod-brand');
        const catInput = document.getElementById('prod-category');
        const imagePreview = document.getElementById('product-image-preview');
        const imageThumb = document.getElementById('product-image-thumb');

        if (data.name && nameInput) {
            nameInput.value = data.name;
            nameInput.classList.add('barcode-found');
            setTimeout(() => nameInput.classList.remove('barcode-found'), 600);
        }
        if (data.brand && brandInput) {
            brandInput.value = data.brand;
        }
        if (data.category && catInput) {
            catInput.value = data.category;
        }

        // Show product image if available
        if (data.imageUrl && imagePreview && imageThumb) {
            imageThumb.src = data.imageUrl;
            imagePreview.classList.remove('hidden');
        }

        // Show success toast
        if (data.name) {
            Utils.haptic('success');
            Swal.fire({
                title: '✅ Producto Encontrado',
                text: data.name,
                icon: 'success',
                timer: 1500,
                showConfirmButton: false,
                toast: true,
                position: 'top-end'
            });
        }
    },

    _mapCategory(hierarchy) {
        const catStr = hierarchy.join(' ').toLowerCase();
        if (catStr.includes('milk') || catStr.includes('cheese') || catStr.includes('dairy') || catStr.includes('lácteos') || catStr.includes('quesos') || catStr.includes('yogurt')) return 'Lácteos';
        if (catStr.includes('meat') || catStr.includes('carnes') || catStr.includes('poultry') || catStr.includes('chicken') || catStr.includes('beef')) return 'Carnes';
        if (catStr.includes('plant-based') || catStr.includes('vegetable') || catStr.includes('verduras') || catStr.includes('vegetales') || catStr.includes('fruit')) return 'Verduras';
        if (catStr.includes('beverage') || catStr.includes('bebidas') || catStr.includes('drinks') || catStr.includes('water') || catStr.includes('juice') || catStr.includes('soda')) return 'Bebidas';
        if (catStr.includes('clean') || catStr.includes('detergent') || catStr.includes('limpieza') || catStr.includes('soap')) return 'Limpieza';
        return 'Otros';
    }
};

// Keep backward compat
window.API = {
    fetchProduct(barcode) {
        BarcodeAPI.lookup(barcode);
    }
};

// ==========================================
// 8. EXPORTAR E IMPORTAR (Excel)
// ==========================================
const DataSync = {
    async exportToExcel() {
        try {
            const products = await db.getAll(STORE_PRODUCTS);
            const history = await db.getAll(STORE_HISTORY);

            const wsProducts = XLSX.utils.json_to_sheet(products.map(p => ({
                ID: p.id,
                Código: p.barcode || '',
                Nombre: p.name,
                Marca: p.brand || '',
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

            Swal.fire({
                title: 'Exportado',
                text: 'El archivo Excel se ha descargado.',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });
        } catch (e) {
            Swal.fire('Error', 'No se pudo exportar: ' + e.message, 'error');
        }
    },

    async importFromExcel(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

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
                            brand: row.Marca || '',
                            category: row.Categoría || 'Otros',
                            price: parseFloat(row.Precio) || 0,
                            expiryDate: row.Vencimiento
                        });
                        count++;
                    }
                }

                Swal.fire({
                    title: `Importación Exitosa`,
                    text: `Se importaron ${count} productos.`,
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });
            } catch (err) {
                Swal.fire('Error', 'Error al leer el archivo. Asegúrate de que tenga el formato correcto.', 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    }
};

// ==========================================
// 9. INICIALIZACIÓN Y EVENT LISTENERS
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

    document.getElementById('btn-menu-toggle')?.addEventListener('click', () => {
        Utils.haptic('light');
        toggleMenu(true);
    });
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
            Utils.haptic('light');
            const target = btn.getAttribute('data-target');
            document.querySelectorAll('.nav-btn').forEach(b => {
                b.classList.remove('active', 'text-ios-black');
                b.classList.add('text-ios-textTitle');
            });
            btn.classList.add('active', 'text-ios-black');
            UI.navigate(target);
            toggleMenu(false);

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
        Utils.haptic('medium');
        document.getElementById('product-form').reset();
        document.getElementById('prod-id').value = '';
        const d = new Date();
        d.setDate(d.getDate() + 7);
        document.getElementById('prod-date').value = d.toISOString().split('T')[0];

        // Reset product image preview
        const imagePreview = document.getElementById('product-image-preview');
        if (imagePreview) imagePreview.classList.add('hidden');

        UI.toggleModal('modal-add', true);
    });

    // Remove image button in form
    document.getElementById('btn-remove-image')?.addEventListener('click', () => {
        const imagePreview = document.getElementById('product-image-preview');
        if (imagePreview) imagePreview.classList.add('hidden');
    });

    document.getElementById('btn-close-modal').addEventListener('click', () => {
        UI.toggleModal('modal-add', false);
    });

    document.getElementById('modal-bg').addEventListener('click', () => {
        UI.toggleModal('modal-add', false);
    });

    document.getElementById('product-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        Utils.haptic('success');

        const data = {
            barcode: document.getElementById('prod-barcode').value.trim(),
            name: document.getElementById('prod-name').value.trim(),
            brand: document.getElementById('prod-brand').value.trim(),
            category: document.getElementById('prod-category').value,
            price: document.getElementById('prod-price').value,
            expiryDate: document.getElementById('prod-date').value
        };

        const id = document.getElementById('prod-id').value;

        if (id) {
            // Update mode
        } else {
            await Logic.addProduct(data);
            Swal.fire({
                title: '✅ Guardado',
                text: 'Producto agregado exitosamente',
                icon: 'success',
                timer: 1200,
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

    // Barcode auto-lookup — debounced on input (not just blur)
    const barcodeInput = document.getElementById('prod-barcode');
    const debouncedLookup = Utils.debounce((val) => {
        if (val.length >= 8) {
            BarcodeAPI.lookup(val);
        }
    }, 500);

    barcodeInput?.addEventListener('input', (e) => {
        debouncedLookup(e.target.value.trim());
    });

    // Also on blur for immediate trigger
    barcodeInput?.addEventListener('blur', (e) => {
        const val = e.target.value.trim();
        if (val.length >= 8) {
            BarcodeAPI.lookup(val);
        }
    });

    // Shopping clear
    document.getElementById('btn-clear-shopping')?.addEventListener('click', async () => {
        Utils.haptic('medium');
        await Logic.clearCheckedShopping();
        UI.refreshAll();
    });

    // Gourmet button
    document.getElementById('btn-gourmet')?.addEventListener('click', () => {
        Utils.haptic('light');
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
        e.target.value = '';
    });
});

// Registrar Service Worker para PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW Registrado', reg.scope))
            .catch(err => console.log('Error registro SW', err));
    });
}
