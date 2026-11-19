// Estado global de la aplicación
const state = {
  config: null,
  products: [],
  categories: [],
  featured: [],
  selectedCategory: 'ALL',
  searchQuery: '',
  cart: {}, // { [productId]: { product, quantity } }
  deliveryType: 'retiro',
  selectedShippingZoneId: null
};

// Formato de moneda argentina ($ 12.345)
function formatMoney(amount) {
  const rounded = Math.round(Number(amount) || 0);
  return '$ ' + rounded.toLocaleString('es-AR');
}

// Actualizar iconos de Lucide dinámicamente
function refreshIcons() {
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}

// Toast flotante animado
function showToast(text, iconName = 'shopping-cart') {
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
  }, 2400);
}

// Registro de PWA Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[SW] ServiceWorker registrado:', reg.scope))
      .catch(err => console.log('SW error:', err));
  });
}

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  loadCartFromStorage();
  await loadStoreConfig();
  await loadProducts();
  refreshIcons();
});

// Cargar configuración de marca, horarios y reglas de envío
async function loadStoreConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    state.config = data;

    // Aplicar nombre y descripción
    document.title = `${data.storeName} - Pedidos por WhatsApp`;
    document.getElementById('storeNameText').textContent = data.storeName;
    document.getElementById('storeTaglineText').textContent = data.storeTagline;

    // Logo del comercio
    const logoContainer = document.getElementById('storeLogoContainer');
    if (data.storeLogo && data.storeLogo.trim()) {
      logoContainer.innerHTML = `<img src="${escapeHtml(data.storeLogo)}" alt="${escapeHtml(data.storeName)}">`;
    }

    // Color primario dinámico vía CSS Variables
    if (data.primaryColor) {
      document.documentElement.style.setProperty('--primary', data.primaryColor);
      document.documentElement.style.setProperty('--primary-hover', adjustColorBrightness(data.primaryColor, -15));
      document.documentElement.style.setProperty('--primary-surface', adjustColorBrightness(data.primaryColor, 40));
    }

    // Poblar zonas de flete en el formulario
    populateShippingZones(data.shippingZones || []);

    // Calcular estado Abierto / Cerrado
    updateStoreBusinessStatus(data);

  } catch (err) {
    console.error('Error al cargar config:', err);
  }
}

// Poblar selector de zonas de flete
function populateShippingZones(zones) {
  const select = document.getElementById('shippingZoneSelect');
  if (!select) return;

  if (zones.length === 0) {
    select.innerHTML = '<option value="">Flete a coordinar con el local</option>';
    return;
  }

  select.innerHTML = zones.map(zone => {
    const priceText = zone.price > 0 ? `(${formatMoney(zone.price)})` : '(A coordinar)';
    return `<option value="${zone.id}" data-price="${zone.price}">${escapeHtml(zone.name)} ${priceText}</option>`;
  }).join('');

  state.selectedShippingZoneId = zones[0]?.id || null;

  select.addEventListener('change', () => {
    state.selectedShippingZoneId = select.value;
    updateCartUI();
  });
}

// Calcular y mostrar si el corralón está Abierto o Cerrado
function updateStoreBusinessStatus(config) {
  const statusPill = document.getElementById('storeStatusPill');
  const statusText = document.getElementById('storeStatusText');
  if (!statusPill || !statusText) return;

  const now = new Date();
  const day = now.getDay();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentTime = hours * 60 + minutes;

  const parseTime = (timeStr, defaultMinutes) => {
    if (!timeStr) return defaultMinutes;
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const openTime = parseTime(config.businessOpenTime, 8 * 60);
  const closeTimeWeekday = parseTime(config.businessCloseTime, 18 * 60);
  const closeTimeSaturday = parseTime(config.businessSaturdayCloseTime, 13 * 60);

  let isOpen = false;
  let label = 'Cerrado';

  if (day >= 1 && day <= 5) {
    if (currentTime >= openTime && currentTime < closeTimeWeekday) {
      isOpen = true;
      label = `Abierto hasta las ${config.businessCloseTime || '18:00'}`;
    } else {
      label = currentTime < openTime ? `Abre a las ${config.businessOpenTime || '08:00'}` : 'Cerrado por hoy';
    }
  } else if (day === 6) {
    if (currentTime >= openTime && currentTime < closeTimeSaturday) {
      isOpen = true;
      label = `Abierto hasta las ${config.businessSaturdayCloseTime || '13:00'}`;
    } else {
      label = 'Cerrado por hoy';
    }
  } else {
    label = 'Cerrado • Abre Lun 08:00';
  }

  if (isOpen) {
    statusPill.className = 'status-pill open';
    statusText.textContent = label;
  } else {
    statusPill.className = 'status-pill closed';
    statusText.textContent = label;
  }
}

function adjustColorBrightness(hex, percent) {
  let num = parseInt(hex.replace('#', ''), 16);
  let amt = Math.round(2.55 * percent);
  let R = (num >> 16) + amt;
  let G = (num >> 8 & 0x00FF) + amt;
  let B = (num & 0x0000FF) + amt;
  return '#' + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (G<255?G<1?0:G:255)*0x100 + (B<255?B<1?0:B:255)).toString(16).slice(1);
}

// Cargar catálogo de productos y destacados
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    state.products = data.products || [];
    state.categories = data.categories || [];
    state.featured = data.featured || [];

    const skeletons = document.getElementById('loadingSkeletons');
    const grid = document.getElementById('productsGrid');
    if (skeletons) skeletons.style.display = 'none';
    if (grid) grid.style.display = 'grid';

    renderCategoryPills();
    renderFeaturedSection();
    renderProducts();
  } catch (err) {
    console.error('Error al cargar productos:', err);
    document.getElementById('loadingSkeletons').innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--danger); font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px;">
        <i data-lucide="alert-triangle" class="icon"></i>
        <span>No se pudo cargar el catálogo de materiales. Verificá la conexión.</span>
      </div>
    `;
    refreshIcons();
  }
}

// Mapeo de miniaturas para categorías
const categoryThumbnails = {
  'Cemento y Cal': '/img/categories/cat-cemento.webp',
  'Cementos y Cales': '/img/categories/cat-cemento.webp',
  'Áridos y Arenas': '/img/categories/cat-aridos.webp',
  'Áridos y Arena': '/img/categories/cat-aridos.webp',
  'Ladrillos y Bloques': '/img/categories/cat-ladrillos.webp',
  'Hierros y Mallas': '/img/categories/cat-hierros.webp',
  'Adhesivos y Pastinas': '/img/categories/cat-adhesivos.webp',
  'Techos': '/img/categories/cat-techos.webp',
  'Viguetas y Techos': '/img/categories/cat-techos.webp',
  'Impermeabilizaciones': '/img/categories/cat-impermeabilizaciones.webp',
  'Impermeabilización': '/img/categories/cat-impermeabilizaciones.webp',
  'Pinturas': '/img/categories/cat-pinturas.webp'
};

function getCategoryThumbHtml(category) {
  if (!category) return '';
  if (categoryThumbnails[category]) {
    return `<img src="${categoryThumbnails[category]}" class="cat-pill-thumb" alt="${escapeHtml(category)}" loading="lazy">`;
  }
  const catLower = category.toLowerCase();
  for (const [key, path] of Object.entries(categoryThumbnails)) {
    if (catLower.includes(key.toLowerCase()) || key.toLowerCase().includes(catLower)) {
      return `<img src="${path}" class="cat-pill-thumb" alt="${escapeHtml(category)}" loading="lazy">`;
    }
  }
  return '';
}

// Renderizar materiales destacados / más pedidos
function renderFeaturedSection() {
  const section = document.getElementById('featuredSection');
  const slider = document.getElementById('featuredSlider');
  if (!section || !slider) return;

  if (state.featured.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  slider.innerHTML = state.featured.map(prod => `
    <div class="featured-card">
      <div style="display: flex; gap: 12px; align-items: center;">
        ${prod.image_url ? `
          <img 
            src="${escapeHtml(prod.image_url)}" 
            alt="${escapeHtml(prod.name)}" 
            class="cart-item-thumb" 
            loading="lazy" 
            style="width: 58px; height: 58px; border-radius: 8px; cursor: pointer;"
            onclick="openProductDetailModal(${prod.id})"
            onerror="this.style.display='none'"
          >
        ` : ''}
        <div style="flex: 1; min-width: 0;">
          <span class="featured-badge">
            <i data-lucide="star" class="icon-sm" style="color: #eab308; fill: #eab308;"></i>
            <span>Más pedido</span>
          </span>
          <h4 class="featured-title" onclick="openProductDetailModal(${prod.id})" style="cursor: pointer;" title="${escapeHtml(prod.name)}">${escapeHtml(prod.name)}</h4>
          <div class="featured-price-row">
            <span class="featured-price">${formatMoney(prod.price)}</span>
            <span style="font-size: 0.78rem; color: var(--text-muted);">x ${escapeHtml(prod.unit)}</span>
          </div>
        </div>
      </div>
      <button type="button" class="btn-quick-add with-icon" onclick="addToCart(${prod.id}, 1)" aria-label="Agregar 1 ${escapeHtml(prod.name)}">
        <i data-lucide="plus" class="icon-sm"></i>
        <span>Agregar</span>
      </button>
    </div>
  `).join('');
  refreshIcons();
}

// Renderizar filtros de categorías con miniatura
function renderCategoryPills() {
  const container = document.getElementById('categoriesSlider');
  container.innerHTML = `
    <button class="cat-pill ${state.selectedCategory === 'ALL' ? 'active' : ''}" data-category="ALL" role="tab">
      <i data-lucide="layers" class="icon-sm" style="margin-right: 6px;"></i>
      <span>Todos los materiales</span>
    </button>
  `;

  state.categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `cat-pill ${state.selectedCategory === cat ? 'active' : ''}`;
    btn.dataset.category = cat;
    btn.role = 'tab';
    btn.innerHTML = `${getCategoryThumbHtml(cat)}<span>${escapeHtml(cat)}</span>`;
    container.appendChild(btn);
  });

  container.querySelectorAll('.cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedCategory = btn.dataset.category;
      renderProducts();
    });
  });
  refreshIcons();
}

function getProductPlaceholderBox(category) {
  return `
    <div class="product-placeholder-box">
      <i data-lucide="package" class="icon-xl"></i>
      <span>${escapeHtml(category || 'Material')}</span>
    </div>
  `;
}

// Filtrar y renderizar productos
function renderProducts() {
  const grid = document.getElementById('productsGrid');
  const noProducts = document.getElementById('noProductsFound');

  const filtered = state.products.filter(prod => {
    const matchesCat = state.selectedCategory === 'ALL' || prod.category === state.selectedCategory;
    const matchesSearch = !state.searchQuery || 
      prod.name.toLowerCase().includes(state.searchQuery) ||
      prod.category.toLowerCase().includes(state.searchQuery);
    return matchesCat && matchesSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '';
    noProducts.style.display = 'block';
    return;
  }

  noProducts.style.display = 'none';
  grid.innerHTML = filtered.map(prod => {
    const isOut = prod.is_out_of_stock === 1;
    const hasImage = prod.image_url && prod.image_url.trim().length > 0;

    return `
      <article class="product-card ${isOut ? 'out-of-stock' : ''}" data-id="${prod.id}">
        <div>
          <div class="product-image-container" onclick="openProductDetailModal(${prod.id})" style="cursor: pointer;" title="Ver detalle de ${escapeHtml(prod.name)}">
            ${isOut ? '<span class="badge badge-danger product-stock-badge">Sin stock</span>' : ''}
            ${hasImage 
              ? `<img src="${escapeHtml(prod.image_url)}" alt="${escapeHtml(prod.name)}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'product-placeholder-box\\'><i data-lucide=\\'package\\' class=\\'icon-xl\\'></i><span>${escapeHtml(prod.category)}</span></div>'; refreshIcons();">` 
              : getProductPlaceholderBox(prod.category)
            }
          </div>

          <div class="product-top">
            <span class="product-category">${escapeHtml(prod.category)}</span>
            ${!isOut ? '<span class="badge badge-success">Disponible</span>' : ''}
          </div>

          <h3 class="product-name" onclick="openProductDetailModal(${prod.id})" style="cursor: pointer;" title="${escapeHtml(prod.name)}">${escapeHtml(prod.name)}</h3>
          
          <div class="product-price-row">
            <span class="product-price">${formatMoney(prod.price)}</span>
            <span class="product-unit">x ${escapeHtml(prod.unit)}</span>
          </div>
        </div>

        <div class="product-actions">
          ${isOut ? `
            <button class="btn-add" disabled>
              Sin stock disponible
            </button>
          ` : `
            <div class="qty-control" aria-label="Cantidad">
              <button type="button" class="qty-btn btn-dec" data-id="${prod.id}" aria-label="Disminuir cantidad">−</button>
              <input type="number" class="qty-input" id="qty-${prod.id}" value="1" min="1" max="999" aria-label="Cantidad para ${escapeHtml(prod.name)}">
              <button type="button" class="qty-btn btn-inc" data-id="${prod.id}" aria-label="Aumentar cantidad">+</button>
            </div>
            <button class="btn-add with-icon" data-id="${prod.id}">
              <i data-lucide="plus" class="icon"></i>
              <span>Agregar</span>
            </button>
          `}
        </div>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('.btn-inc').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(`qty-${btn.dataset.id}`);
      input.value = Math.max(1, parseInt(input.value || 1, 10) + 1);
    });
  });

  grid.querySelectorAll('.btn-dec').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(`qty-${btn.dataset.id}`);
      const val = parseInt(input.value || 1, 10);
      if (val > 1) input.value = val - 1;
    });
  });

  grid.querySelectorAll('.btn-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const prodId = Number(btn.dataset.id);
      const input = document.getElementById(`qty-${prodId}`);
      const qty = parseInt(input ? input.value : 1, 10) || 1;
      addToCart(prodId, qty);
    });
  });

  refreshIcons();
}

// Gestión del Carrito
function addToCart(productId, quantity) {
  const prod = state.products.find(p => p.id === productId);
  if (!prod) return;

  if (!state.cart[productId]) {
    state.cart[productId] = { product: prod, quantity: 0 };
  }
  state.cart[productId].quantity += quantity;
  
  saveCartToStorage();
  updateCartUI();
  showToast(`Agregaste ${quantity} ${prod.unit} de "${prod.name}"`, 'shopping-cart');
}

function updateCartQuantity(productId, quantity) {
  if (quantity <= 0) {
    removeFromCart(productId);
    return;
  }
  if (state.cart[productId]) {
    state.cart[productId].quantity = quantity;
  }
  saveCartToStorage();
  updateCartUI();
  renderCartModalItems();
}

function removeFromCart(productId) {
  const item = state.cart[productId];
  if (item) {
    showToast(`Quitaste "${item.product.name}"`, 'trash-2');
  }
  delete state.cart[productId];
  saveCartToStorage();
  updateCartUI();
  renderCartModalItems();
}

function getCartTotals() {
  let count = 0;
  let subtotal = 0;
  for (const item of Object.values(state.cart)) {
    count += item.quantity;
    subtotal += item.product.price * item.quantity;
  }

  let shippingCost = 0;
  if (state.deliveryType === 'envio' && state.config?.shippingZones) {
    const zone = state.config.shippingZones.find(z => z.id === state.selectedShippingZoneId);
    if (zone) shippingCost = zone.price;
  }

  const grandTotal = subtotal + shippingCost;
  return { count, subtotal, shippingCost, total: grandTotal };
}

function updateCartUI() {
  const { count, subtotal, shippingCost, total } = getCartTotals();
  const bar = document.getElementById('cartFloatingBar');
  const minOrderAlert = document.getElementById('minOrderAlert');
  const minOrderAlertText = document.getElementById('minOrderAlertText');
  const btnSubmit = document.getElementById('btnSubmitOrder');
  const shippingRow = document.getElementById('cartShippingRow');

  if (count > 0) {
    bar.classList.add('visible');
    document.getElementById('cartFloatingCount').textContent = `${count} ${count === 1 ? 'material' : 'materiales'}`;
    document.getElementById('cartFloatingTotal').textContent = formatMoney(total);
    document.getElementById('cartModalSubtotal').textContent = formatMoney(subtotal);
    document.getElementById('cartModalShipping').textContent = shippingCost > 0 ? formatMoney(shippingCost) : 'A coordinar';
    document.getElementById('cartModalTotal').textContent = formatMoney(total);

    if (state.deliveryType === 'envio') {
      shippingRow.style.display = 'flex';
    } else {
      shippingRow.style.display = 'none';
    }

    // Validación de Pedido Mínimo
    const minAmount = state.config?.minOrderAmount || 0;
    if (state.deliveryType === 'envio' && minAmount > 0 && subtotal < minAmount) {
      const diff = minAmount - subtotal;
      minOrderAlert.style.display = 'flex';
      minOrderAlertText.innerHTML = `El pedido mínimo para envíos es de <strong>${formatMoney(minAmount)}</strong>. Te faltan <strong>${formatMoney(diff)}</strong> para alcanzarlo.`;
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.style.opacity = '0.6';
        btnSubmit.innerHTML = `<span>Monto mínimo no alcanzado</span>`;
      }
    } else {
      minOrderAlert.style.display = 'none';
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.style.opacity = '1';
        btnSubmit.innerHTML = `
          <i data-lucide="message-circle" class="icon"></i>
          <span>Enviar Pedido por WhatsApp</span>
        `;
        refreshIcons();
      }
    }
  } else {
    bar.classList.remove('visible');
    document.getElementById('cartFloatingCount').textContent = '0 materiales';
    document.getElementById('cartFloatingTotal').textContent = '$ 0';
    document.getElementById('cartModalSubtotal').textContent = '$ 0';
    document.getElementById('cartModalTotal').textContent = '$ 0';
    minOrderAlert.style.display = 'none';
  }
}

function renderCartModalItems() {
  const list = document.getElementById('cartItemsList');
  const items = Object.values(state.cart);

  if (items.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 40px 10px; color: var(--text-muted);">
        <i data-lucide="shopping-cart" class="icon-xl" style="width: 48px; height: 48px; color: var(--text-subtle); display: block; margin: 0 auto 12px;"></i>
        <h4 style="font-size: 1.1rem; font-weight: 700; color: var(--text-main);">Tu pedido está vacío</h4>
        <p style="font-size: 0.88rem; margin-top: 4px;">Seleccioná materiales del catálogo para armar tu pedido.</p>
      </div>
    `;
    document.getElementById('btnSubmitOrder').disabled = true;
    refreshIcons();
    return;
  }

  list.innerHTML = items.map(item => {
    const subtotal = item.product.price * item.quantity;
    const hasImage = item.product.image_url && item.product.image_url.trim().length > 0;
    const itemImg = hasImage
      ? `<img src="${escapeHtml(item.product.image_url)}" alt="${escapeHtml(item.product.name)}" class="cart-item-thumb" onerror="this.style.display='none'">`
      : `<div class="cart-item-thumb-placeholder"><i data-lucide="package" class="icon-sm"></i></div>`;

    return `
      <div class="cart-item">
        ${itemImg}
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.product.name)}</div>
          <div class="cart-item-meta">${formatMoney(item.product.price)} x ${escapeHtml(item.product.unit)}</div>
        </div>

        <div class="qty-control" style="transform: scale(0.9); height: 38px;">
          <button type="button" class="qty-btn" onclick="updateCartQuantity(${item.product.id}, ${item.quantity - 1})" aria-label="Menos">−</button>
          <span class="qty-input" style="line-height: 38px;">${item.quantity}</span>
          <button type="button" class="qty-btn" onclick="updateCartQuantity(${item.product.id}, ${item.quantity + 1})" aria-label="Más">+</button>
        </div>

        <div class="cart-item-total">${formatMoney(subtotal)}</div>

        <button type="button" class="cart-item-remove" onclick="removeFromCart(${item.product.id})" title="Quitar este material" aria-label="Eliminar ${escapeHtml(item.product.name)}">
          <i data-lucide="trash-2" class="icon-sm"></i>
        </button>
      </div>
    `;
  }).join('');

  refreshIcons();
  updateCartUI();
}

function saveCartToStorage() {
  try {
    localStorage.setItem('corralon_cart', JSON.stringify(state.cart));
  } catch (e) {}
}

function loadCartFromStorage() {
  try {
    const saved = localStorage.getItem('corralon_cart');
    if (saved) {
      state.cart = JSON.parse(saved);
      updateCartUI();
    }
  } catch (e) {}
}

// Configuración de Eventos UI
function setupEventListeners() {
  const searchInput = document.getElementById('searchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    if (state.searchQuery) {
      searchClearBtn.classList.add('visible');
    } else {
      searchClearBtn.classList.remove('visible');
    }
    renderProducts();
  });

  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    searchClearBtn.classList.remove('visible');
    renderProducts();
    searchInput.focus();
  });

  const btnReset = document.getElementById('btnResetFilters');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      searchClearBtn.classList.remove('visible');
      state.selectedCategory = 'ALL';
      renderCategoryPills();
      renderProducts();
    });
  }

  // Drawer Carrito
  const drawerBackdrop = document.getElementById('cartDrawerBackdrop');
  const btnOpenCart = document.getElementById('btnOpenCart');
  const btnCloseCart = document.getElementById('btnCloseCart');
  const btnCloseSuccess = document.getElementById('btnCloseSuccess');
  const btnNewOrder = document.getElementById('btnNewOrder');

  const openDrawer = () => {
    renderCartModalItems();
    document.getElementById('cartView').style.display = 'flex';
    document.getElementById('successView').style.display = 'none';
    drawerBackdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  const closeDrawer = () => {
    drawerBackdrop.classList.remove('active');
    document.body.style.overflow = '';
  };

  btnOpenCart.addEventListener('click', openDrawer);
  btnCloseCart.addEventListener('click', closeDrawer);
  btnCloseSuccess.addEventListener('click', closeDrawer);
  btnNewOrder.addEventListener('click', closeDrawer);

  drawerBackdrop.addEventListener('click', (e) => {
    if (e.target === drawerBackdrop) closeDrawer();
  });

  // Switch Retiro vs Envío
  const btnPickup = document.getElementById('btnDeliveryPickup');
  const btnShipping = document.getElementById('btnDeliveryShipping');
  const addressGroup = document.getElementById('deliveryAddressGroup');
  const addressInput = document.getElementById('deliveryAddress');

  btnPickup.addEventListener('click', () => {
    btnPickup.classList.add('active');
    btnShipping.classList.remove('active');
    state.deliveryType = 'retiro';
    addressGroup.style.display = 'none';
    addressInput.removeAttribute('required');
    updateCartUI();
  });

  btnShipping.addEventListener('click', () => {
    btnShipping.classList.add('active');
    btnPickup.classList.remove('active');
    state.deliveryType = 'envio';
    addressGroup.style.display = 'block';
    addressInput.setAttribute('required', 'true');
    updateCartUI();
    addressInput.focus();
  });

  // Enviar Pedido por WhatsApp
  const btnSubmit = document.getElementById('btnSubmitOrder');
  btnSubmit.addEventListener('click', handleOrderSubmit);

  // Setup de "Repetir mi último pedido"
  setupRepeatOrderFeature();

  // Setup de modal Detalle de Producto
  const productDetailModal = document.getElementById('productDetailModal');
  const btnCloseProductDetail = document.getElementById('btnCloseProductDetail');
  if (btnCloseProductDetail) {
    btnCloseProductDetail.addEventListener('click', () => {
      productDetailModal.classList.remove('active');
    });
  }
  if (productDetailModal) {
    productDetailModal.addEventListener('click', (e) => {
      if (e.target === productDetailModal) productDetailModal.classList.remove('active');
    });
  }
}

// -------------------------------------------------------------------
// FUNCIÓN: REPETIR PEDIDO ANTERIOR
// -------------------------------------------------------------------
function setupRepeatOrderFeature() {
  const modal = document.getElementById('repeatOrderModal');
  const btnOpen = document.getElementById('btnOpenRepeatOrder');
  const btnClose = document.getElementById('btnCloseRepeatOrder');
  const form = document.getElementById('repeatOrderForm');
  const phoneInput = document.getElementById('repeatOrderPhone');
  const results = document.getElementById('repeatOrderResults');
  const loading = document.getElementById('repeatOrderLoading');
  const notice = document.getElementById('repeatOrderNotice');

  btnOpen.addEventListener('click', () => {
    modal.classList.add('active');
    notice.style.display = 'none';
    phoneInput.focus();
  });

  btnClose.addEventListener('click', () => {
    modal.classList.remove('active');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = phoneInput.value.trim();
    if (!phone) return;

    loading.style.display = 'block';
    results.innerHTML = '';
    notice.style.display = 'none';

    try {
      const res = await fetch(`/api/customer/orders?phone=${encodeURIComponent(phone)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al buscar pedidos');

      const orders = data.orders || [];
      if (orders.length === 0) {
        results.innerHTML = `
          <div style="text-align: center; padding: 24px; color: var(--text-muted);">
            <p style="font-weight: 700;">No encontramos pedidos con ese número de teléfono.</p>
            <p style="font-size: 0.85rem; margin-top: 4px;">Asegurate de haber ingresado el número con el que hiciste pedidos antes.</p>
          </div>
        `;
        return;
      }

      results.innerHTML = orders.map(ord => {
        const date = new Date(ord.created_at).toLocaleDateString('es-AR', {
          day: '2-digit', month: '2-digit', year: 'numeric'
        });
        const itemsBrief = (ord.items || []).map(i => `${i.quantity} ${i.unit} ${i.product_name}`).join(', ');

        return `
          <div class="repeat-order-card">
            <div class="repeat-order-header">
              <div>
                <strong style="color: var(--secondary);">Pedido #${escapeHtml(ord.order_number)}</strong>
                <span class="badge badge-status-${escapeHtml((ord.status || '').toLowerCase())}" style="margin-left: 8px; font-size: 0.75rem;">${escapeHtml(ord.status)}</span>
              </div>
              <span style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(date)}</span>
            </div>
            <p class="repeat-order-items">${escapeHtml(itemsBrief)}</p>
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
              <span style="font-weight: 800; font-size: 1rem; color: var(--secondary);">${escapeHtml(ord.totalFormatted)}</span>
              <button type="button" class="btn btn-primary btn-sm btn-load-repeat with-icon" data-id="${ord.id}">
                <i data-lucide="shopping-cart" class="icon-sm"></i>
                <span>Cargar este pedido</span>
              </button>
            </div>
          </div>
        `;
      }).join('');

      refreshIcons();

      results.querySelectorAll('.btn-load-repeat').forEach(btn => {
        btn.addEventListener('click', async () => {
          const orderId = Number(btn.dataset.id);
          await handleLoadRepeatOrder(orderId, modal, notice, phone);
        });
      });

    } catch (err) {
      alert(err.message);
    } finally {
      loading.style.display = 'none';
    }
  });
}

// Cargar pedido anterior en el carrito con chequeo de stock y precios
async function handleLoadRepeatOrder(orderId, modal, noticeEl, phone) {
  try {
    const res = await fetch('/api/customer/repeat-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, phone })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar el pedido.');

    if (data.items.length === 0) {
      alert('Los productos de este pedido ya no se encuentran disponibles.');
      return;
    }

    // Cargar ítems al carrito
    state.cart = {};
    for (const item of data.items) {
      state.cart[item.productId] = {
        product: item.product,
        quantity: item.quantity
      };
    }
    saveCartToStorage();

    // Precargar teléfono en el formulario de pedido si está disponible
    const phoneInput = document.getElementById('customerPhone');
    if (phoneInput && phone) phoneInput.value = phone;

    updateCartUI();

    // Mostrar advertencias si las hubo
    if (data.alerts && data.alerts.length > 0) {
      const messages = data.alerts.map(a => `• ${a.message}`).join('\n');
      alert(`Avisos sobre tu pedido:\n\n${messages}\n\nLos materiales disponibles se cargaron a tu carrito.`);
    }

    modal.classList.remove('active');
    showToast('¡Pedido anterior cargado en tu carrito!', 'rotate-ccw');

    // Abrir el drawer del carrito para revisar
    document.getElementById('btnOpenCart').click();

  } catch (err) {
    alert('Error al cargar pedido anterior: ' + err.message);
  }
}

// Procesar y enviar pedido
async function handleOrderSubmit() {
  const { count, subtotal } = getCartTotals();
  if (count === 0) {
    alert('Tu carrito está vacío.');
    return;
  }

  // Validación de Pedido Mínimo
  const minAmount = state.config?.minOrderAmount || 0;
  if (state.deliveryType === 'envio' && minAmount > 0 && subtotal < minAmount) {
    alert(`El pedido mínimo para envíos a domicilio es de ${formatMoney(minAmount)}. Por favor agregá más materiales para continuar.`);
    return;
  }

  const customerName = document.getElementById('customerName').value.trim();
  const customerPhone = document.getElementById('customerPhone').value.trim();
  const deliveryAddress = document.getElementById('deliveryAddress').value.trim();
  const notes = document.getElementById('orderNotes').value.trim();

  if (!customerName) {
    alert('Por favor ingresá tu nombre y apellido.');
    document.getElementById('customerName').focus();
    return;
  }
  if (!customerPhone) {
    alert('Por favor ingresá tu número de teléfono o WhatsApp.');
    document.getElementById('customerPhone').focus();
    return;
  }
  if (state.deliveryType === 'envio' && !deliveryAddress) {
    alert('Por favor ingresá la dirección de entrega de la obra o domicilio.');
    document.getElementById('deliveryAddress').focus();
    return;
  }

  const items = Object.values(state.cart).map(item => ({
    productId: item.product.id,
    quantity: item.quantity
  }));

  const btnSubmit = document.getElementById('btnSubmitOrder');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<span>Registrando pedido...</span>`;

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName,
        customerPhone,
        deliveryType: state.deliveryType,
        deliveryAddress: state.deliveryType === 'envio' ? deliveryAddress : '',
        shippingZoneId: state.deliveryType === 'envio' ? state.selectedShippingZoneId : null,
        notes,
        items
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al guardar el pedido');
    }

    // Pedido registrado con éxito
    window.open(data.whatsappUrl, '_blank');

    document.getElementById('cartView').style.display = 'none';
    document.getElementById('successView').style.display = 'flex';
    document.getElementById('successOrderNumber').textContent = `Pedido #${data.orderNumber} • ${data.totalFormatted}`;
    document.getElementById('btnReopenWhatsApp').href = data.whatsappUrl;

    state.cart = {};
    saveCartToStorage();
    updateCartUI();

  } catch (err) {
    console.error('Error al enviar pedido:', err);
    alert('Ocurrió un error al procesar el pedido: ' + err.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `
      <i data-lucide="message-circle" class="icon"></i>
      <span>Enviar Pedido por WhatsApp</span>
    `;
    refreshIcons();
  }
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

// Modal de Detalle de Producto Ampliado
function openProductDetailModal(productId) {
  const prod = state.products.find(p => p.id === productId);
  if (!prod) return;

  const modal = document.getElementById('productDetailModal');
  const title = document.getElementById('modalDetailTitle');
  const body = document.getElementById('modalDetailBody');
  const isOut = prod.is_out_of_stock === 1;

  if (title) title.textContent = prod.name;

  const hasImage = prod.image_url && prod.image_url.trim().length > 0;
  const imageHtml = hasImage
    ? `<img src="${escapeHtml(prod.image_url)}" alt="${escapeHtml(prod.name)}" class="detail-modal-img" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'product-placeholder-box\\' style=\\'height: 240px;\\'><i data-lucide=\\'package\\' class=\\'icon-xl\\'></i><span>${escapeHtml(prod.category)}</span></div>'; refreshIcons();">`
    : `<div class="product-placeholder-box" style="height: 240px;"><i data-lucide="package" class="icon-xl"></i><span>${escapeHtml(prod.category)}</span></div>`;

  body.innerHTML = `
    <div class="detail-modal-grid">
      <div style="position: relative;">
        ${imageHtml}
        ${isOut ? '<span class="badge badge-danger product-stock-badge" style="top: 12px; left: 12px;">Sin stock</span>' : ''}
      </div>
      <div>
        <div style="margin-bottom: 8px;">
          <span class="product-category">${escapeHtml(prod.category)}</span>
          ${!isOut ? '<span class="badge badge-success" style="margin-left: 6px;">Disponible</span>' : ''}
        </div>
        <h3 style="font-size: 1.35rem; font-weight: 800; color: var(--secondary); margin-bottom: 10px;">${escapeHtml(prod.name)}</h3>
        <div style="font-size: 1.5rem; font-weight: 800; color: var(--primary); margin-bottom: 6px;">
          ${formatMoney(prod.price)}
          <span style="font-size: 0.88rem; font-weight: 600; color: var(--text-muted);">x ${escapeHtml(prod.unit)}</span>
        </div>
        <p style="font-size: 0.86rem; color: var(--text-muted); margin-bottom: 18px; line-height: 1.45;">
          Material de primera calidad garantizado. Envíos programados a obra o retiro inmediato en depósito.
        </p>

        ${isOut ? `
          <div class="badge badge-danger" style="padding: 10px 14px; font-size: 0.9rem; width: 100%; justify-content: center;">
            <i data-lucide="package-x" class="icon"></i>
            <span>Sin stock disponible temporalmente</span>
          </div>
        ` : `
          <div style="display: flex; gap: 10px; align-items: center; margin-top: 14px;">
            <div class="qty-control" style="height: 44px;">
              <button type="button" class="qty-btn" id="modalBtnDec" aria-label="Disminuir cantidad">−</button>
              <input type="number" class="qty-input" id="modalQtyInput" value="1" min="1" max="999" style="width: 48px; font-weight: 700;">
              <button type="button" class="qty-btn" id="modalBtnInc" aria-label="Aumentar cantidad">+</button>
            </div>
            <button type="button" class="btn btn-primary with-icon" id="modalBtnAdd" style="flex: 1; height: 44px; justify-content: center;">
              <i data-lucide="plus" class="icon"></i>
              <span>Agregar al Pedido</span>
            </button>
          </div>
        `}
      </div>
    </div>
  `;

  modal.classList.add('active');
  refreshIcons();

  if (!isOut) {
    const qtyInput = document.getElementById('modalQtyInput');
    const btnDec = document.getElementById('modalBtnDec');
    const btnInc = document.getElementById('modalBtnInc');
    const btnAdd = document.getElementById('modalBtnAdd');

    btnDec.addEventListener('click', () => {
      const val = parseInt(qtyInput.value || 1, 10);
      if (val > 1) qtyInput.value = val - 1;
    });

    btnInc.addEventListener('click', () => {
      qtyInput.value = Math.max(1, parseInt(qtyInput.value || 1, 10) + 1);
    });

    btnAdd.addEventListener('click', () => {
      const qty = parseInt(qtyInput.value || 1, 10) || 1;
      addToCart(prod.id, qty);
      modal.classList.remove('active');
    });
  }
}
