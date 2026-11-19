// Estado del Panel Admin
const adminState = {
  config: null,
  orders: [],
  products: [],
  currentTab: 'orders',
  statusFilter: 'Todos',
  dateFilter: 'all',
  metricsRange: 'today',
  productSearchQuery: '',
  selectedOrder: null,
  lastOrderId: 0,
  pendingNotify: null
};

// Actualizar iconos de Lucide dinámicamente
function refreshIcons() {
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}

// Generador de badge de estado con icono Lucide + texto + color suave
function getStatusBadge(status) {
  let iconName = 'clock';
  let badgeClass = 'badge-nuevo';
  if (status === 'Nuevo') {
    iconName = 'clock';
    badgeClass = 'badge-status-nuevo';
  } else if (status === 'Preparando') {
    iconName = 'package-open';
    badgeClass = 'badge-status-preparando';
  } else if (status === 'Listo') {
    iconName = 'check-circle-2';
    badgeClass = 'badge-status-listo';
  } else if (status === 'Entregado') {
    iconName = 'truck';
    badgeClass = 'badge-status-entregado';
  } else if (status === 'Cancelado') {
    iconName = 'x-circle';
    badgeClass = 'badge-status-cancelado';
  }
  return `<span class="badge ${badgeClass}"><i data-lucide="${iconName}" class="icon-sm"></i> <span>${escapeHtml(status)}</span></span>`;
}

// Formato de moneda argentina ($ 12.345)
function formatMoney(amount) {
  const rounded = Math.round(Number(amount) || 0);
  return '$ ' + rounded.toLocaleString('es-AR');
}

// Toast flotante
function showToast(text, iconName = 'bell') {
  const toast = document.getElementById('toastMessage');
  const toastText = document.getElementById('toastText');
  const toastIcon = document.getElementById('toastIcon');
  if (toastText) toastText.textContent = text;
  if (toastIcon) {
    toastIcon.innerHTML = `<i data-lucide="${iconName}" class="icon"></i>`;
    refreshIcons();
  }
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}

// Chime sonoro con Web Audio API (dos tonos nítidos)
function playNewOrderChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.frequency.setValueAtTime(587.33, now); // D5
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.4);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.frequency.setValueAtTime(880, now + 0.16); // A5
    gain2.gain.setValueAtTime(0.3, now + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.16);
    osc2.stop(now + 0.8);
  } catch (e) {
    console.log('Chime sound blocked by autoplay policy:', e);
  }
}

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadStoreConfig();
  await checkAuth();
  refreshIcons();
});

// Cargar configuración de marca
async function loadStoreConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    adminState.config = data;

    document.getElementById('adminStoreName').textContent = data.storeName;
    if (data.primaryColor) {
      document.documentElement.style.setProperty('--primary', data.primaryColor);
    }
  } catch (err) {
    console.error('Error al cargar config:', err);
  }
}

// Verificar autenticación
async function checkAuth() {
  try {
    const res = await fetch('/api/admin/check-auth');
    const data = await res.json();

    if (data.authenticated) {
      document.getElementById('loginView').style.display = 'none';
      document.getElementById('dashboardView').style.display = 'block';
      await loadDashboardData();
      initLiveUpdates();
    } else {
      document.getElementById('loginView').style.display = 'flex';
      document.getElementById('dashboardView').style.display = 'none';
    }
  } catch (err) {
    console.error('Error al verificar sesión:', err);
  }
}

// Iniciar actualizaciones en vivo (SSE + Polling fallback)
function initLiveUpdates() {
  const liveIndicator = document.getElementById('liveIndicator');

  if (window.EventSource) {
    const sse = new EventSource('/api/admin/events');

    sse.addEventListener('new_order', (e) => {
      try {
        const orderData = JSON.parse(e.data);
        handleNewOrderReceived(orderData);
      } catch (err) {}
    });

    sse.addEventListener('status_change', (e) => {
      loadOrders();
      if (adminState.currentTab === 'metrics') loadMetrics(adminState.metricsRange);
    });

    sse.onerror = () => {
      if (liveIndicator) liveIndicator.className = 'status-pill closed';
    };

    sse.onopen = () => {
      if (liveIndicator) liveIndicator.className = 'status-pill open';
    };
  }

  // Polling de seguridad cada 5 segundos
  setInterval(async () => {
    if (!adminState.lastOrderId) return;
    try {
      const res = await fetch(`/api/admin/orders/check-updates?lastId=${adminState.lastOrderId}`);
      const data = await res.json();
      if (data.hasNew && data.newOrders && data.newOrders.length > 0) {
        handleNewOrderReceived(data.newOrders[0]);
      }
    } catch (e) {}
  }, 5000);
}

// Manejar nuevo pedido entrante en vivo
function handleNewOrderReceived(orderData) {
  playNewOrderChime();
  showToast(`¡Nuevo Pedido #${orderData.orderNumber} de ${orderData.customerName}!`, 'bell');
  loadOrders();
  if (adminState.currentTab === 'metrics') {
    loadMetrics(adminState.metricsRange);
  }
}

// Cargar datos del dashboard
async function loadDashboardData() {
  await Promise.all([loadOrders(), loadProducts(), loadMetrics('today')]);
}

// -------------------------------------------------------------------
// GESTIÓN DE PEDIDOS
// -------------------------------------------------------------------
async function loadOrders() {
  const loading = document.getElementById('ordersLoading');
  const list = document.getElementById('ordersList');
  loading.style.display = 'block';

  try {
    let url = `/api/admin/orders?`;
    if (adminState.statusFilter && adminState.statusFilter !== 'Todos') {
      url += `status=${encodeURIComponent(adminState.statusFilter)}&`;
    }
    if (adminState.dateFilter && adminState.dateFilter !== 'all') {
      url += `dateRange=${encodeURIComponent(adminState.dateFilter)}&`;
    }

    const res = await fetch(url);
    if (res.status === 401) return checkAuth();
    const data = await res.json();
    adminState.orders = data.orders || [];

    if (adminState.orders.length > 0) {
      adminState.lastOrderId = Math.max(...adminState.orders.map(o => o.id));
    }

    document.getElementById('ordersCountBadge').textContent = adminState.orders.length;
    renderOrders();
  } catch (err) {
    console.error('Error al cargar pedidos:', err);
  } finally {
    loading.style.display = 'none';
  }
}

function renderOrders() {
  const list = document.getElementById('ordersList');
  const noOrders = document.getElementById('noOrdersMessage');

  if (adminState.orders.length === 0) {
    list.innerHTML = '';
    noOrders.style.display = 'block';
    return;
  }

  noOrders.style.display = 'none';
  list.innerHTML = adminState.orders.map(order => {
    const dateFormatted = new Date(order.created_at).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const isShipping = order.delivery_type === 'envio';
    const deliveryBadge = isShipping 
      ? `<span class="badge badge-info"><i data-lucide="truck" class="icon-sm"></i> <span>Envío: ${escapeHtml(order.delivery_address || 'Sin dirección')}</span></span>`
      : `<span class="badge badge-warning"><i data-lucide="store" class="icon-sm"></i> <span>Retiro en local</span></span>`;

    const itemsPreview = order.items && order.items.length > 0
      ? order.items.map(i => `${i.quantity} ${i.unit} ${i.product_name}`).join(', ')
      : 'Sin ítems detallados';

    const itemThumbs = (order.items || []).filter(i => i.image_url).slice(0, 5);
    const thumbsHtml = itemThumbs.length > 0 
      ? `<div style="display: flex; gap: 6px; margin-top: 6px; align-items: center;">
          ${itemThumbs.map(i => `<img src="${escapeHtml(i.image_url)}" class="admin-order-thumb" alt="${escapeHtml(i.product_name)}" title="${escapeHtml(i.product_name)}">`).join('')}
        </div>`
      : '';

    const clientPhoneClean = String(order.customer_phone).replace(/[^0-9]/g, '');
    const waClientLink = `https://wa.me/${clientPhoneClean.startsWith('54') ? clientPhoneClean : '549' + clientPhoneClean}?text=${encodeURIComponent(`¡Hola ${order.customer_name}! Te escribimos de ${adminState.config?.storeName || 'Corralón'} sobre tu Pedido #${order.order_number}:`)}`;

    return `
      <article class="order-card" data-id="${order.id}">
        <div class="order-card-header">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="order-num">Pedido #${escapeHtml(order.order_number)}</span>
            ${getStatusBadge(order.status)}
            <span class="order-date"> • ${escapeHtml(dateFormatted)}</span>
          </div>
          <select class="status-select status-${escapeHtml(order.status)}" data-id="${order.id}" onclick="event.stopPropagation()">
            <option value="Nuevo" ${order.status === 'Nuevo' ? 'selected' : ''}>Nuevo</option>
            <option value="Preparando" ${order.status === 'Preparando' ? 'selected' : ''}>Preparando</option>
            <option value="Listo" ${order.status === 'Listo' ? 'selected' : ''}>Listo</option>
            <option value="Entregado" ${order.status === 'Entregado' ? 'selected' : ''}>Entregado</option>
            <option value="Cancelado" ${order.status === 'Cancelado' ? 'selected' : ''}>Cancelado</option>
          </select>
        </div>

        <div class="order-customer">
          <strong class="with-icon"><i data-lucide="user" class="icon-sm"></i> <span>${escapeHtml(order.customer_name)}</span></strong> 
          <span style="color: var(--text-muted); font-size: 0.85rem;">(${escapeHtml(order.customer_phone)})</span>
          <div style="margin-top: 6px; display: flex; gap: 8px;">
            <a href="tel:${String(order.customer_phone).replace(/[^0-9+]/g,'')}" onclick="event.stopPropagation()" class="btn btn-outline btn-sm with-icon" style="padding: 2px 8px; font-size: 0.75rem;" title="Llamar al cliente">
              <i data-lucide="phone" class="icon-sm"></i>
              <span>Llamar</span>
            </a>
            <a href="${escapeHtml(waClientLink)}" onclick="event.stopPropagation()" target="_blank" class="btn btn-outline btn-sm with-icon" style="padding: 2px 8px; font-size: 0.75rem; color: #15803d; border-color: #bbf7d0;" title="Abrir WhatsApp">
              <i data-lucide="message-circle" class="icon-sm"></i>
              <span>WhatsApp</span>
            </a>
            <a href="/admin/orders/${order.id}/remito" onclick="event.stopPropagation()" target="_blank" class="btn btn-outline btn-sm with-icon" style="padding: 2px 8px; font-size: 0.75rem;" title="Imprimir Remito A4">
              <i data-lucide="printer" class="icon-sm"></i>
              <span>Remito</span>
            </a>
          </div>
        </div>

        <div class="order-delivery">
          ${deliveryBadge}
        </div>

        <div class="order-items-preview">
          <div><strong style="color: var(--secondary);">Materiales:</strong> ${escapeHtml(itemsPreview)}</div>
          ${thumbsHtml}
        </div>

        <div class="order-card-footer">
          <div class="order-total-badge">Total: ${escapeHtml(order.totalFormatted)}</div>
          <button type="button" class="btn btn-outline btn-sm btn-view-detail with-icon" data-id="${order.id}">
            <i data-lucide="clipboard-list" class="icon-sm"></i>
            <span>Ver Detalle Completo</span>
          </button>
        </div>
      </article>
    `;
  }).join('');

  refreshIcons();

  list.querySelectorAll('.status-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const orderId = select.dataset.id;
      const newStatus = e.target.value;
      await updateOrderStatus(orderId, newStatus, select);
    });
  });

  list.querySelectorAll('.order-card').forEach(card => {
    card.addEventListener('click', () => {
      const orderId = Number(card.dataset.id);
      openOrderDetail(orderId);
    });
  });
}

// Actualizar estado de pedido en el servidor con aviso de WhatsApp al cliente
async function updateOrderStatus(orderId, newStatus, selectEl) {
  try {
    const res = await fetch(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    if (!res.ok) throw new Error('No se pudo actualizar el estado.');
    const data = await res.json();

    // Actualizar estado local
    const order = adminState.orders.find(o => o.id === Number(orderId));
    if (order) order.status = newStatus;

    if (selectEl) {
      selectEl.className = `status-select status-${newStatus}`;
    }
    showToast(`Pedido actualizado a: "${newStatus}"`);

    // Si tiene mensaje de notificación sugerido, ofrecer enviarlo por WhatsApp
    if (data.notificationMessage && ['Preparando', 'Listo', 'Entregado'].includes(newStatus)) {
      openNotifyWhatsAppModal(data.notificationMessage, data.customerPhone, data.orderNumber);
    }

    if (adminState.currentTab === 'metrics') {
      loadMetrics(adminState.metricsRange);
    }
  } catch (err) {
    alert('Error al actualizar estado: ' + err.message);
    await loadOrders();
  }
}

// Modal para avisar al cliente por WhatsApp con mensaje pre-armado y editable
function openNotifyWhatsAppModal(message, phone, orderNumber) {
  adminState.pendingNotify = { phone, message, orderNumber };
  const modal = document.getElementById('whatsappNotifyModal');
  const textarea = document.getElementById('notifyMessageText');
  textarea.value = message;
  modal.classList.add('active');
}

// Abrir drawer lateral con detalle del pedido (Slide-Over)
function openOrderDetail(orderId) {
  const order = adminState.orders.find(o => o.id === orderId);
  if (!order) return;

  const backdrop = document.getElementById('orderDrawerBackdrop');
  const title = document.getElementById('orderDetailTitle');
  const body = document.getElementById('orderDetailBody');

  title.textContent = `Pedido #${order.order_number}`;

  const dateFormatted = new Date(order.created_at).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  let itemsHtml = (order.items || []).map(item => `
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 10px 4px; font-weight: 700;">
        <div style="display: flex; align-items: center; gap: 8px;">
          ${item.image_url 
            ? `<img src="${escapeHtml(item.image_url)}" class="admin-order-thumb" alt="${escapeHtml(item.product_name)}" onerror="this.style.display='none'">` 
            : `<div class="admin-order-thumb" style="display: inline-flex; align-items: center; justify-content: center; background: #f1f5f9;"><i data-lucide="package" class="icon-sm"></i></div>`}
          <span>${escapeHtml(item.product_name)}</span>
        </div>
      </td>
      <td style="padding: 10px 4px; text-align: center;">${item.quantity} ${escapeHtml(item.unit)}</td>
      <td style="padding: 10px 4px; text-align: right;">${item.unitPriceFormatted}</td>
      <td style="padding: 10px 4px; text-align: right; font-weight: 800;">${item.subtotalFormatted}</td>
    </tr>
  `).join('');

  const clientPhoneClean = String(order.customer_phone).replace(/[^0-9]/g, '');
  const waClientLink = `https://wa.me/${clientPhoneClean.startsWith('54') ? clientPhoneClean : '549' + clientPhoneClean}?text=${encodeURIComponent(`¡Hola ${order.customer_name}! Te escribimos de ${adminState.config?.storeName || 'Corralón'} sobre tu Pedido #${order.order_number}:`)}`;

  body.innerHTML = `
    <div style="background: var(--surface-alt); padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--border); margin-bottom: 18px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        ${getStatusBadge(order.status)}
        <span style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(dateFormatted)}</span>
      </div>

      <p class="with-icon" style="font-size: 1.05rem; font-weight: 800; color: var(--secondary);">
        <i data-lucide="user" class="icon-sm"></i>
        <span>${escapeHtml(order.customer_name)}</span>
      </p>
      <p class="with-icon" style="font-size: 0.92rem; color: var(--text-muted); margin-top: 4px;">
        <i data-lucide="phone" class="icon-sm"></i>
        <span>Tel: <strong>${escapeHtml(order.customer_phone)}</strong></span>
      </p>
      
      <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
        <a href="tel:${String(order.customer_phone).replace(/[^0-9+]/g,'')}" class="btn btn-outline btn-sm with-icon" style="flex: 1; justify-content: center;">
          <i data-lucide="phone" class="icon-sm"></i>
          <span>Llamar</span>
        </a>
        <a href="${escapeHtml(waClientLink)}" target="_blank" class="btn btn-primary btn-sm with-icon" style="flex: 1; background: #25d366; justify-content: center;">
          <i data-lucide="message-circle" class="icon-sm"></i>
          <span>WhatsApp</span>
        </a>
        <a href="/admin/orders/${order.id}/remito" target="_blank" class="btn btn-outline btn-sm with-icon" style="flex: 1; justify-content: center;">
          <i data-lucide="printer" class="icon-sm"></i>
          <span>Remito A4</span>
        </a>
      </div>
    </div>

    <div style="margin-bottom: 16px;">
      <h4 style="font-size: 0.88rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 8px;">
        Modalidad de entrega
      </h4>
      <p class="with-icon" style="font-size: 0.95rem; font-weight: 700;">
        ${order.delivery_type === 'envio' 
          ? '<i data-lucide="truck" class="icon-sm"></i> <span>Envío a domicilio / obra</span>' 
          : '<i data-lucide="store" class="icon-sm"></i> <span>Retiro en el local</span>'}
      </p>
      ${order.delivery_address ? `
        <p class="with-icon" style="font-size: 0.92rem; color: var(--text-muted); margin-top: 4px; background: white; border: 1px solid var(--border); padding: 8px 12px; border-radius: var(--radius-sm);">
          <i data-lucide="map-pin" class="icon-sm"></i>
          <span><strong>Dirección:</strong> ${escapeHtml(order.delivery_address)}</span>
        </p>
      ` : ''}
      ${order.shipping_zone ? `
        <p class="with-icon" style="font-size: 0.88rem; color: var(--text-muted); margin-top: 4px;">
          <i data-lucide="map" class="icon-sm"></i>
          <span><strong>Zona de flete:</strong> ${escapeHtml(order.shipping_zone)}</span>
        </p>
      ` : ''}
      ${order.notes ? `
        <p class="with-icon" style="font-size: 0.92rem; background: var(--warning-bg); color: var(--warning-text); border: 1px solid #fde68a; padding: 8px 12px; border-radius: var(--radius-sm); margin-top: 8px;">
          <i data-lucide="clipboard-pen" class="icon-sm"></i>
          <span><strong>Observaciones:</strong> ${escapeHtml(order.notes)}</span>
        </p>
      ` : ''}
    </div>

    <h4 style="font-size: 0.88rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 8px;">
      Materiales del pedido
    </h4>

    <table style="width: 100%; border-collapse: collapse; font-size: 0.88rem; margin-bottom: 20px;">
      <thead>
        <tr style="border-bottom: 2px solid var(--border); text-align: left; color: var(--text-muted);">
          <th style="padding: 8px 4px;">Material</th>
          <th style="padding: 8px 4px; text-align: center;">Cant.</th>
          <th style="padding: 8px 4px; text-align: right;">Precio</th>
          <th style="padding: 8px 4px; text-align: right;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="checkout-summary">
      ${order.shipping_cost > 0 ? `
        <div class="summary-row">
          <span>Flete / Envío:</span>
          <span>$ ${Math.round(order.shipping_cost).toLocaleString('es-AR')}</span>
        </div>
      ` : ''}
      <div class="summary-row total-row">
        <span>TOTAL:</span>
        <span>${escapeHtml(order.totalFormatted)}</span>
      </div>
    </div>
  `;

  refreshIcons();
  backdrop.classList.add('active');
  document.body.style.overflow = 'hidden';
}

// -------------------------------------------------------------------
// PESTAÑA: MÉTRICAS Y RESUMEN DEL DÍA
// -------------------------------------------------------------------
async function loadMetrics(range = 'today') {
  try {
    adminState.metricsRange = range;
    const res = await fetch(`/api/admin/metrics?range=${range}`);
    if (res.status === 401) return checkAuth();
    const data = await res.json();

    document.getElementById('metricTotalRevenue').textContent = data.totalRevenueFormatted || '$ 0';
    document.getElementById('metricTotalOrders').textContent = data.totalOrders || 0;
    document.getElementById('metricAvgTicket').textContent = data.avgTicketFormatted || '$ 0';
    
    const active = (data.statusCounts?.Nuevo || 0) + (data.statusCounts?.Preparando || 0);
    document.getElementById('metricActiveOrders').textContent = active;

    // Renderizar Top 5 Productos
    const tbody = document.getElementById('topProductsTableBody');
    if (data.topProducts && data.topProducts.length > 0) {
      tbody.innerHTML = data.topProducts.map((p, idx) => `
        <tr>
          <td><strong>#${idx + 1} ${escapeHtml(p.product_name)}</strong></td>
          <td style="text-align: center; font-weight: 700;">${p.totalQty} ${escapeHtml(p.unit)}</td>
          <td style="text-align: right; font-weight: 800; color: var(--success);">${p.totalSubtotalFormatted}</td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" style="text-align: center; padding: 20px; color: var(--text-muted);">
            No hay ventas registradas en este período.
          </td>
        </tr>
      `;
    }
    refreshIcons();
  } catch (err) {
    console.error('Error al cargar métricas:', err);
  }
}

// -------------------------------------------------------------------
// GESTIÓN DE PRODUCTOS
// -------------------------------------------------------------------
async function loadProducts() {
  try {
    const res = await fetch('/api/admin/products');
    if (res.status === 401) return checkAuth();
    const data = await res.json();
    adminState.products = data.products || [];

    document.getElementById('productsCountBadge').textContent = adminState.products.length;
    renderProductsTable();
  } catch (err) {
    console.error('Error al cargar productos admin:', err);
  }
}

function renderProductsTable() {
  const tbody = document.getElementById('productsTableBody');
  const query = adminState.productSearchQuery.toLowerCase().trim();

  const filtered = adminState.products.filter(p => {
    if (!query) return true;
    return p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 40px; color: var(--text-muted);">
          No se encontraron materiales con ese criterio.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(prod => {
    const isLow = prod.isLowStock;
    const stockBadge = isLow 
      ? `<span class="badge badge-warning with-icon" style="margin-left: 6px;"><i data-lucide="alert-triangle" class="icon-sm"></i> <span>Bajo</span></span>` 
      : '';

    const prodImgHtml = prod.image_url 
      ? `<img src="${escapeHtml(prod.image_url)}" class="admin-prod-thumb" alt="${escapeHtml(prod.name)}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'admin-prod-thumb-placeholder\\'><i data-lucide=\\'package\\' class=\\'icon-sm\\'></i></div>'; refreshIcons();">`
      : `<div class="admin-prod-thumb-placeholder"><i data-lucide="package" class="icon-sm"></i></div>`;

    return `
      <tr>
        <td style="text-align: center; vertical-align: middle;">
          ${prodImgHtml}
        </td>
        <td>
          <div style="font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
            ${prod.is_featured ? '<i data-lucide="star" class="icon-sm" style="color: #eab308; fill: #eab308;"></i> ' : ''}<span>${escapeHtml(prod.name)}</span>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">
            Stock mínimo: ${prod.min_stock || 10} ${escapeHtml(prod.unit)}
          </div>
        </td>
        <td><span class="cat-pill" style="padding: 3px 10px; font-size: 0.75rem;">${escapeHtml(prod.category)}</span></td>
        <td>${escapeHtml(prod.unit)}</td>
        <td style="font-weight: 800; color: var(--secondary);">${prod.priceFormatted}</td>
        <td>
          <strong>${prod.stock}</strong> ${escapeHtml(prod.unit)}
          ${stockBadge}
        </td>
        <td style="text-align: center;">
          <label class="switch">
            <input type="checkbox" class="toggle-outofstock" data-id="${prod.id}" ${prod.is_out_of_stock ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </td>
        <td style="text-align: center;">
          <label class="switch">
            <input type="checkbox" class="toggle-active" data-id="${prod.id}" ${prod.is_active ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </td>
        <td style="text-align: right;">
          <button type="button" class="btn btn-outline btn-sm btn-edit-prod" data-id="${prod.id}" title="Editar" aria-label="Editar ${escapeHtml(prod.name)}">
            <i data-lucide="pencil" class="icon-sm"></i>
          </button>
          <button type="button" class="btn btn-outline btn-sm btn-delete-prod" data-id="${prod.id}" title="Eliminar" aria-label="Eliminar ${escapeHtml(prod.name)}" style="color: var(--danger);">
            <i data-lucide="trash-2" class="icon-sm"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  refreshIcons();

  tbody.querySelectorAll('.toggle-outofstock').forEach(sw => {
    sw.addEventListener('change', async () => {
      const id = Number(sw.dataset.id);
      await quickUpdateProduct(id, { is_out_of_stock: sw.checked ? 1 : 0 });
    });
  });

  tbody.querySelectorAll('.toggle-active').forEach(sw => {
    sw.addEventListener('change', async () => {
      const id = Number(sw.dataset.id);
      await quickUpdateProduct(id, { is_active: sw.checked ? 1 : 0 });
    });
  });

  tbody.querySelectorAll('.btn-edit-prod').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      openProductModal(id);
    });
  });

  tbody.querySelectorAll('.btn-delete-prod').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      await deleteProduct(id);
    });
  });
}

async function quickUpdateProduct(id, partial) {
  const prod = adminState.products.find(p => p.id === id);
  if (!prod) return;

  const updated = {
    name: prod.name,
    category: prod.category,
    unit: prod.unit,
    price: prod.price,
    stock: prod.stock,
    min_stock: prod.min_stock,
    is_active: prod.is_active,
    is_out_of_stock: prod.is_out_of_stock,
    image_url: prod.image_url || '',
    is_featured: prod.is_featured || 0,
    ...partial
  };

  try {
    const res = await fetch(`/api/admin/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    if (!res.ok) throw new Error('Error al actualizar');
    Object.assign(prod, updated);
    showToast('Material actualizado correctamente.');
  } catch (err) {
    alert(err.message);
    await loadProducts();
  }
}

function openProductModal(productId = null) {
  const modal = document.getElementById('productModal');
  const title = document.getElementById('productModalTitle');
  const form = document.getElementById('productForm');
  const previewBox = document.getElementById('prodImagePreviewBox');
  const previewImg = document.getElementById('prodImagePreview');

  form.reset();
  previewBox.style.display = 'none';

  if (productId) {
    const prod = adminState.products.find(p => p.id === productId);
    if (!prod) return;

    title.textContent = 'Editar Material';
    document.getElementById('editProductId').value = prod.id;
    document.getElementById('prodName').value = prod.name;
    document.getElementById('prodCategory').value = prod.category;
    document.getElementById('prodUnit').value = prod.unit;
    document.getElementById('prodPrice').value = prod.price;
    document.getElementById('prodStock').value = prod.stock;
    document.getElementById('prodMinStock').value = prod.min_stock !== undefined ? prod.min_stock : 10;
    document.getElementById('prodImageUrl').value = prod.image_url || '';
    document.getElementById('prodIsFeatured').checked = Boolean(prod.is_featured);
    document.getElementById('prodIsOutOfStock').checked = Boolean(prod.is_out_of_stock);
    document.getElementById('prodIsActive').checked = Boolean(prod.is_active);

    if (prod.image_url) {
      previewImg.src = prod.image_url;
      previewBox.style.display = 'block';
    }
  } else {
    title.textContent = 'Nuevo Material';
    document.getElementById('editProductId').value = '';
    document.getElementById('prodImageUrl').value = '';
    document.getElementById('prodIsActive').checked = true;
    document.getElementById('prodIsOutOfStock').checked = false;
    document.getElementById('prodIsFeatured').checked = false;
    document.getElementById('prodMinStock').value = 10;
  }

  modal.classList.add('active');
}

async function handleProductFormSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('editProductId').value;
  const fileInput = document.getElementById('prodImageFile');
  let imageUrl = document.getElementById('prodImageUrl').value.trim();

  // Si se seleccionó un archivo de imagen, subirlo primero
  if (fileInput.files[0]) {
    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    try {
      const uploadRes = await fetch('/api/admin/upload-image', {
        method: 'POST',
        body: formData
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Error subiendo foto');
      imageUrl = uploadData.imageUrl;
    } catch (err) {
      alert(err.message);
      return;
    }
  }

  const payload = {
    name: document.getElementById('prodName').value.trim(),
    category: document.getElementById('prodCategory').value.trim(),
    unit: document.getElementById('prodUnit').value,
    price: Number(document.getElementById('prodPrice').value),
    stock: Number(document.getElementById('prodStock').value) || 0,
    min_stock: Number(document.getElementById('prodMinStock').value) || 10,
    image_url: imageUrl,
    is_featured: document.getElementById('prodIsFeatured').checked ? 1 : 0,
    is_out_of_stock: document.getElementById('prodIsOutOfStock').checked ? 1 : 0,
    is_active: document.getElementById('prodIsActive').checked ? 1 : 0
  };

  try {
    const url = id ? `/api/admin/products/${id}` : '/api/admin/products';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');

    document.getElementById('productModal').classList.remove('active');
    showToast(id ? 'Material actualizado con éxito.' : 'Material agregado con éxito.');
    await loadProducts();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteProduct(id) {
  const prod = adminState.products.find(p => p.id === id);
  if (!prod) return;

  if (!confirm(`¿Estás seguro de que querés eliminar "${prod.name}" del catálogo?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/products/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('No se pudo eliminar');
    showToast('Material eliminado.');
    await loadProducts();
  } catch (err) {
    alert(err.message);
  }
}

// -------------------------------------------------------------------
// IMPORTACIÓN DE CSV
// -------------------------------------------------------------------
function downloadCsvTemplate() {
  const sampleCSV = `nombre,categoria,unidad,precio,stock
Cemento Portland Loma Negra 50 kg,Cemento y Cal,bolsa,9800,150
Cal Hidratada Cacique 25 kg,Cemento y Cal,bolsa,4200,200
Arena Gruesa de Río,Áridos y Arenas,m3,28500,50
Piedra Partida Granítica 6-20,Áridos y Arenas,m3,42000,30
Ladrillo Hueco 12x18x33,Ladrillos y Bloques,unidad,680,1500
Hierro ADN 420 Ø 10 mm x 12 m,Hierros y Mallas,barra,14200,250
Klaukol Impermeable 30 kg,Adhesivos y Pastinas,bolsa,12400,100`;

  const blob = new Blob([sampleCSV], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla_materiales_corralon.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function handleCsvImportSubmit(e) {
  e.preventDefault();

  const fileInput = document.getElementById('csvFileInput');
  const textInput = document.getElementById('csvTextInput');
  const statusMsg = document.getElementById('csvStatusMessage');
  const btnSubmit = document.getElementById('btnSubmitCsv');

  statusMsg.style.display = 'none';

  if (!fileInput.files[0] && !textInput.value.trim()) {
    alert('Por favor seleccioná un archivo CSV o pegá las filas en el campo de texto.');
    return;
  }

  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Importando...';

  try {
    let res;
    if (fileInput.files[0]) {
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      res = await fetch('/api/admin/products/import-csv', {
        method: 'POST',
        body: formData
      });
    } else {
      res = await fetch('/api/admin/products/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText: textInput.value.trim() })
      });
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al importar.');

    statusMsg.style.display = 'block';
    statusMsg.style.background = 'var(--success-bg)';
    statusMsg.style.color = 'var(--success-text)';
    statusMsg.textContent = data.message;

    showToast(`¡${data.count} materiales importados con éxito!`);
    await loadProducts();

    setTimeout(() => {
      document.getElementById('csvImportModal').classList.remove('active');
      statusMsg.style.display = 'none';
    }, 1500);

  } catch (err) {
    statusMsg.style.display = 'block';
    statusMsg.style.background = 'var(--danger-bg)';
    statusMsg.style.color = 'var(--danger-text)';
    statusMsg.textContent = err.message;
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Importar Catálogo';
  }
}

// -------------------------------------------------------------------
// CONFIGURACIÓN DE LISTENERS
// -------------------------------------------------------------------
function setupEventListeners() {
  const loginForm = document.getElementById('loginForm');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('adminPasswordInput').value;
    const loginError = document.getElementById('loginError');
    loginError.style.display = 'none';

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');

      await checkAuth();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.style.display = 'block';
    }
  });

  document.getElementById('btnLogout').addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    location.reload();
  });

  // Pestañas
  const tabOrders = document.getElementById('tabOrders');
  const tabMetrics = document.getElementById('tabMetrics');
  const tabProducts = document.getElementById('tabProducts');
  const tabBtnOrders = document.getElementById('tabBtnOrders');
  const tabBtnMetrics = document.getElementById('tabBtnMetrics');
  const tabBtnProducts = document.getElementById('tabBtnProducts');

  tabBtnOrders.addEventListener('click', () => {
    tabBtnOrders.classList.add('active');
    tabBtnMetrics.classList.remove('active');
    tabBtnProducts.classList.remove('active');
    tabOrders.style.display = 'block';
    tabMetrics.style.display = 'none';
    tabProducts.style.display = 'none';
    adminState.currentTab = 'orders';
    loadOrders();
  });

  tabBtnMetrics.addEventListener('click', () => {
    tabBtnMetrics.classList.add('active');
    tabBtnOrders.classList.remove('active');
    tabBtnProducts.classList.remove('active');
    tabMetrics.style.display = 'block';
    tabOrders.style.display = 'none';
    tabProducts.style.display = 'none';
    adminState.currentTab = 'metrics';
    loadMetrics(adminState.metricsRange);
  });

  tabBtnProducts.addEventListener('click', () => {
    tabBtnProducts.classList.add('active');
    tabBtnOrders.classList.remove('active');
    tabBtnMetrics.classList.remove('active');
    tabProducts.style.display = 'block';
    tabOrders.style.display = 'none';
    tabMetrics.style.display = 'none';
    adminState.currentTab = 'products';
    loadProducts();
  });

  // Rango de Métricas
  document.querySelectorAll('.metrics-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.metrics-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadMetrics(btn.dataset.range);
    });
  });

  // Filtros de estado de pedidos
  document.querySelectorAll('.filter-status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      adminState.statusFilter = btn.dataset.status;
      loadOrders();
    });
  });

  // Filtro de fecha de pedidos
  const dateFilterSelect = document.getElementById('adminDateFilter');
  if (dateFilterSelect) {
    dateFilterSelect.addEventListener('change', (e) => {
      adminState.dateFilter = e.target.value;
      loadOrders();
    });
  }

  // Exportar pedidos a CSV
  const btnExportCsv = document.getElementById('btnExportCsv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => {
      const url = `/api/admin/orders/export-csv?status=${encodeURIComponent(adminState.statusFilter)}&dateRange=${encodeURIComponent(adminState.dateFilter)}`;
      window.location.href = url;
    });
  }

  // Búsqueda de productos en admin
  document.getElementById('adminProductSearch').addEventListener('input', (e) => {
    adminState.productSearchQuery = e.target.value;
    renderProductsTable();
  });

  // Cerrar Drawer de Detalle Pedido
  const orderDrawerBackdrop = document.getElementById('orderDrawerBackdrop');
  const closeOrderDrawer = () => {
    orderDrawerBackdrop.classList.remove('active');
    document.body.style.overflow = '';
  };

  document.getElementById('btnCloseOrderDetail').addEventListener('click', closeOrderDrawer);
  orderDrawerBackdrop.addEventListener('click', (e) => {
    if (e.target === orderDrawerBackdrop) closeOrderDrawer();
  });

  // Modal Notificación WhatsApp al cliente
  const notifyModal = document.getElementById('whatsappNotifyModal');
  const btnCloseNotify = document.getElementById('btnCloseNotifyModal');
  const btnCancelNotify = document.getElementById('btnCancelNotify');
  const btnSendNotify = document.getElementById('btnSendNotifyWhatsApp');

  const closeNotify = () => notifyModal.classList.remove('active');
  btnCloseNotify.addEventListener('click', closeNotify);
  btnCancelNotify.addEventListener('click', closeNotify);
  notifyModal.addEventListener('click', (e) => {
    if (e.target === notifyModal) closeNotify();
  });

  btnSendNotify.addEventListener('click', () => {
    if (!adminState.pendingNotify) return;
    const cleanPhone = String(adminState.pendingNotify.phone).replace(/[^0-9]/g, '');
    const text = document.getElementById('notifyMessageText').value;
    const waUrl = `https://wa.me/${cleanPhone.startsWith('54') ? cleanPhone : '549' + cleanPhone}?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
    closeNotify();
  });

  // Preview de foto en modal de producto
  const prodImageFileInput = document.getElementById('prodImageFile');
  if (prodImageFileInput) {
    prodImageFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          document.getElementById('prodImagePreview').src = re.target.result;
          document.getElementById('prodImagePreviewBox').style.display = 'block';
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Modal Producto
  document.getElementById('btnOpenCreateProduct').addEventListener('click', () => openProductModal());
  document.getElementById('btnCloseProductModal').addEventListener('click', () => {
    document.getElementById('productModal').classList.remove('active');
  });
  document.getElementById('btnCancelProductModal').addEventListener('click', () => {
    document.getElementById('productModal').classList.remove('active');
  });
  document.getElementById('productForm').addEventListener('submit', handleProductFormSubmit);

  // Modal CSV
  document.getElementById('btnOpenImportCSV').addEventListener('click', () => {
    document.getElementById('csvImportModal').classList.add('active');
  });
  document.getElementById('btnCloseCsvModal').addEventListener('click', () => {
    document.getElementById('csvImportModal').classList.remove('active');
  });
  document.getElementById('btnCancelCsvModal').addEventListener('click', () => {
    document.getElementById('csvImportModal').classList.remove('active');
  });
  document.getElementById('btnDownloadCsvTemplate').addEventListener('click', downloadCsvTemplate);
  document.getElementById('csvImportForm').addEventListener('submit', handleCsvImportSubmit);

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
