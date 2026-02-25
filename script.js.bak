/**
 * Gestión de Inventario Doméstico - Lógica Principal
 * PWA + Vanilla JS + IndexedDB
 */

// ==========================================
// 1. CONFIGURATION Y ESTADOS
// ==========================================
const DB_NAME = 'InventoryDB';
const DB_VERSION = 1;

const STORE_PRODUCTS = 'products';
const STORE_HISTORY = 'history';

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

        this.renderDashboard(products, history);
        this.renderInventory(products);
        this.renderHistory(history);
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
        document.getElementById('stat-loss').innerText = `$${loss.toFixed(2)}`;

        this.updateCharts(categories, history);
    },

    checkAlerts(products) {
        const container = document.getElementById('alerts-container');
        const countSafe = products.filter(p => p.statusObj === 'safe').length;
        const alerts = products.filter(p => p.statusObj === 'warning' || p.statusObj === 'danger');

        if (alerts.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-500 py-6 italic text-sm">Tu inventario está en excelentes condiciones.</div>`;
            return;
        }

        let html = '<div class="divide-y divide-gray-100 dark:divide-gray-700">';
        // Tomar top 5 alertas
        alerts.slice(0, 5).forEach(p => {
            const icon = p.statusObj === 'danger' ? 'fa-triangle-exclamation text-red-500' : 'fa-clock text-yellow-500';
            const textClass = p.statusObj === 'danger' ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-yellow-700 dark:text-yellow-400 font-medium';
            const daysText = p.daysRemaining < 0 ? `Vencido hace ${Math.abs(p.daysRemaining)} días` : (p.daysRemaining === 0 ? 'Vence hoy' : `Vence en ${p.daysRemaining} días`);

            html += `
            <div class="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                <i class="fa-solid ${icon} text-lg w-6 text-center"></i>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-gray-900 dark:text-white truncate">${p.name}</p>
                    <p class="text-xs ${textClass}">${daysText}</p>
                </div>
                <button onclick="window.UI.quickAction(${p.id}, 'consumed')" class="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded hover:bg-green-200 transition">Consumir</button>
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
                <div class="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
                    <i class="fa-solid fa-box-open text-4xl mb-3 opacity-50"></i>
                    <p>No hay productos que mostrar.</p>
                </div>`;
            return;
        }

        let html = '';
        filtered.forEach(p => {
            const statusColor = p.statusObj === 'safe' ? 'text-status-safe bg-green-50 dark:bg-green-900/20' :
                p.statusObj === 'warning' ? 'text-status-warning bg-yellow-50 dark:bg-yellow-900/20' :
                    'text-status-danger bg-red-50 dark:bg-red-900/20';
            const borderStatus = p.statusObj === 'safe' ? 'border-transparent' :
                p.statusObj === 'warning' ? 'border-yellow-200 dark:border-yellow-800' :
                    'border-red-300 dark:border-red-800';

            const daysMsg = p.daysRemaining > 0 ? `Vence en ${p.daysRemaining} días` : (p.daysRemaining === 0 ? 'Vence hoy' : 'Vencido');

            html += `
            <div class="product-card bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 ${borderStatus} relative overflow-hidden group">
                <div class="absolute top-0 right-0 w-12 h-12 rounded-bl-full flex items-start justify-end p-2 ${p.statusObj === 'safe' ? 'bg-green-100' : 'bg-red-100'} dark:bg-opacity-20 transition"></div>
                
                <div class="flex justify-between items-start mb-3 relative z-10">
                    <div>
                        <span class="text-xs font-semibold px-2.5 py-1 rounded-lg ${statusColor} mb-2 inline-block">${p.category}</span>
                        <h3 class="font-bold text-gray-900 dark:text-white text-lg leading-tight mb-1">${p.name}</h3>
                        <p class="text-sm text-gray-500 dark:text-gray-400"><i class="fa-solid fa-barcode mr-1 opacity-70"></i> ${p.barcode || 'Sin código'}</p>
                    </div>
                </div>
                
                <div class="mb-4">
                    <p class="text-sm font-medium ${p.statusObj === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}">
                        <i class="fa-regular fa-calendar mr-1"></i> ${daysMsg} (${p.expiryDate})
                    </p>
                </div>

                <div class="flex flex-col sm:flex-row gap-2 border-t border-gray-100 dark:border-gray-700 pt-3 mt-auto">
                    <button onclick="window.UI.processProduct(${p.id}, 'consumed')" class="flex-1 bg-green-100 hover:bg-green-200 text-green-700 dark:bg-green-900/30 dark:hover:bg-green-800/50 dark:text-green-400 rounded-xl py-3 sm:py-2 text-sm font-semibold transition flex items-center justify-center gap-1">
                        <i class="fa-solid fa-check"></i> Consumí
                    </button>
                    <button onclick="window.UI.processProduct(${p.id}, 'wasted')" class="flex-1 bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-800/50 dark:text-red-400 rounded-xl py-3 sm:py-2 text-sm font-semibold transition flex items-center justify-center gap-1">
                        <i class="fa-solid fa-trash-can"></i> Tiré
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
                <tr class="bg-white dark:bg-gray-800 border-b dark:border-gray-700">
                    <td colspan="4" class="px-6 py-8 text-center text-gray-500">
                        No hay registros en el historial.
                    </td>
                </tr>`;
            return;
        }

        let html = '';
        history.forEach(h => {
            const statusChip = h.finalStatus === 'consumed'
                ? '<span class="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded dark:bg-green-900 dark:text-green-300">Consumido</span>'
                : '<span class="bg-red-100 text-red-800 text-xs font-semibold px-2.5 py-0.5 rounded dark:bg-red-900 dark:text-red-300">Desperdicio</span>';

            const price = h.price ? `$${h.price.toFixed(2)}` : '-';
            const lossColor = h.finalStatus === 'wasted' && h.price > 0 ? 'text-red-600 font-bold' : '';

            html += `
            <tr class="bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition">
                <td class="px-4 xl:px-6 py-4 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px] sm:max-w-none">
                    ${h.name}
                    <div class="text-xs text-gray-500 font-normal">${new Date(h.dateRemoved).toLocaleDateString()}</div>
                </td>
                <td class="px-4 xl:px-6 py-4 hidden sm:table-cell">${h.category}</td>
                <td class="px-2 xl:px-6 py-4 text-center">${statusChip}</td>
                <td class="px-4 xl:px-6 py-4 text-right ${lossColor}">${price}</td>
            </tr>`;
        });
        container.innerHTML = html;
    },

    updateCharts(categories, history) {
        // Grafico 1: Categorias (Pie)
        const ctxCat = document.getElementById('categoryChart');
        if (chartCategory) chartCategory.destroy();

        const catLabels = Object.keys(categories);
        const catData = Object.values(categories);

        // Colors palette
        const bgColors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

        // Determine text color based on theme
        const isDark = document.body.classList.contains('dark');
        const textColor = isDark ? '#e5e7eb' : '#374151';

        chartCategory = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
                labels: catLabels.length ? catLabels : ['Vacío'],
                datasets: [{
                    data: catData.length ? catData : [1],
                    backgroundColor: catData.length ? bgColors : ['#e5e7eb'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: textColor, font: { family: 'Inter' } } }
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
                    y: { beginAtZero: true, ticks: { stepSize: 1, color: textColor }, grid: { color: isDark ? '#374151' : '#e5e7eb' } },
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
            text: text,
            icon: icon,
            showCancelButton: true,
            confirmButtonColor: confirmColor,
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Sí, confirmar',
            cancelButtonText: 'Cancelar'
        });

        if (result.isConfirmed) {
            await Logic.moveToHistory(id, finalStatus);
            Swal.fire({
                title: 'Actualizado!',
                text: 'El historial ha sido actualizado.',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });
        }
    },

    quickAction(id, action) {
        this.processProduct(id, action);
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

                // Simulación de búsqueda en DB local/API externa
                const mockProducts = {
                    '740100511': { name: 'Refresco Cola', cat: 'Bebidas' },
                    '123456789': { name: 'Pan de Molde Blanco', cat: 'Otros' }
                };
                if (mockProducts[decodedText]) {
                    document.getElementById('prod-name').value = mockProducts[decodedText].name;
                    document.getElementById('prod-category').value = mockProducts[decodedText].cat;
                    Swal.fire({
                        title: 'Producto Encontrado',
                        text: mockProducts[decodedText].name,
                        icon: 'success',
                        timer: 1500,
                        showConfirmButton: false,
                        toast: true,
                        position: 'top-end'
                    });
                }
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
    // Theme setup
    const themeBtn = document.getElementById('theme-toggle');
    const isDark = localStorage.getItem('theme') === 'dark' ||
        (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) document.body.classList.add('dark');

    themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark');
        const darkEnabled = document.body.classList.contains('dark');
        localStorage.setItem('theme', darkEnabled ? 'dark' : 'light');
        UI.refreshAll(); // Para actualizar colores de los gráficos
    });

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
            UI.navigate(target);
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
    document.getElementById('btn-export-excel').addEventListener('click', () => {
        DataSync.exportToExcel();
    });

    const fileInput = document.getElementById('excel-file-input');
    document.getElementById('btn-import-excel').addEventListener('click', () => {
        fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            DataSync.importFromExcel(e.target.files[0]);
        }
        e.target.value = ''; // Reset
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
