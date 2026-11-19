const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const crypto = require('crypto');
const QRCode = require('qrcode');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { db, getNextOrderNumber } = require('./database');

const app = express();
app.set('trust proxy', 1);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Límites antispam
const orderRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 5, // máximo 5 pedidos por IP
  statusCode: 429,
  skipFailedRequests: true, // No computa pedidos rechazados por validación (400)
  message: { error: 'Límite de pedidos alcanzado: máximo 5 pedidos cada 10 minutos por dirección IP.' },
  standardHeaders: true,
  legacyHeaders: false
});

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // máximo 10 intentos de login
  statusCode: 429,
  message: { error: 'Demasiados intentos de acceso fallidos. Por favor esperá 15 minutos para reintentar.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Carpeta de imágenes subidas desde el panel. En Render se apunta al disco persistente (UPLOADS_DIR=/data/uploads).
const UPLOADS_DIR = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(__dirname, 'public', 'uploads');

// Configuración de multer para imágenes de productos en disco (solo JPG, PNG y WebP)
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = UPLOADS_DIR;
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const unique = `prod-${Date.now()}-${Math.round(Math.random() * 1E6)}${ext}`;
    cb(null, unique);
  }
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype) && ALLOWED_IMAGE_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Formato no permitido. Solo se aceptan archivos JPG, PNG o WebP.'));
    }
  }
});

// SSE clients para notificaciones en vivo
const sseAdminClients = new Set();
function broadcastOrderEvent(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseAdminClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseAdminClients.delete(client);
    }
  }
}

// Tokens de sesión admin simples en memoria
const adminSessions = new Set();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Formateador de moneda es-AR
function formatMoney(amount) {
  const rounded = Math.round(Number(amount) || 0);
  return '$ ' + rounded.toLocaleString('es-AR');
}

// Middleware de autenticación admin
function requireAdminAuth(req, res, next) {
  const token = req.cookies?.admin_session;
  if (token && adminSessions.has(token)) {
    return next();
  }
  return res.status(401).json({ error: 'No autorizado. Iniciá sesión con la contraseña de administrador.' });
}

// ---------------------------------------------------------------------
// RUTAS PÚBLICAS
// ---------------------------------------------------------------------

// Configuración pública (branding, colores, WhatsApp)
app.get('/api/config', (req, res) => {
  res.json({
    storeName: config.STORE_NAME,
    storeTagline: config.STORE_TAGLINE,
    storeLogo: config.STORE_LOGO,
    primaryColor: config.PRIMARY_COLOR,
    secondaryColor: config.SECONDARY_COLOR,
    whatsappPhone: config.WHATSAPP_PHONE,
    currencySymbol: config.CURRENCY_SYMBOL,
    locale: config.LOCALE,
    businessOpenTime: config.BUSINESS_OPEN_TIME,
    businessCloseTime: config.BUSINESS_CLOSE_TIME,
    businessSaturdayCloseTime: config.BUSINESS_SATURDAY_CLOSE_TIME,
    businessHoursText: config.BUSINESS_HOURS_TEXT,
    minOrderAmount: config.MIN_ORDER_AMOUNT,
    shippingZones: config.SHIPPING_ZONES
  });
});

// Manifiesto dinámico PWA
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.json({
    name: `${config.STORE_NAME} - Pedidos`,
    short_name: config.STORE_NAME.length > 18 ? config.STORE_NAME.slice(0, 16) + '...' : config.STORE_NAME,
    description: `Catálogo de materiales y pedidos por WhatsApp de ${config.STORE_NAME}`,
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: config.PRIMARY_COLOR || '#f97316',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/icons/icon.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      }
    ]
  });
});

// Catálogo de productos activos para clientes
app.get('/api/products', (req, res) => {
  try {
    const products = db.prepare(`
      SELECT id, name, category, unit, price, stock, is_out_of_stock, image_url, is_featured
      FROM products
      WHERE is_active = 1
      ORDER BY category ASC, name ASC
    `).all();

    // Obtener lista de categorías únicas disponibles
    const categories = [...new Set(products.map(p => p.category))];
    const featured = products.filter(p => p.is_featured === 1);

    res.json({ products, categories, featured });
  } catch (err) {
    console.error('Error al obtener productos:', err);
    res.status(500).json({ error: 'Error al consultar productos' });
  }
});

// Crear nuevo pedido y generar enlace WhatsApp
app.post('/api/orders', orderRateLimiter, (req, res) => {
  try {
    const { customerName, customerPhone, deliveryType, deliveryAddress, shippingZoneId, notes, items } = req.body;

    // Validaciones básicas
    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
    }
    const trimmedPhone = customerPhone !== undefined && customerPhone !== null ? String(customerPhone).trim() : '';
    if (!trimmedPhone) {
      return res.status(400).json({ error: 'El teléfono es obligatorio.' });
    }
    // Validar teléfono en el servidor: solo dígitos, espacios, +, -, paréntesis; entre 8 y 20 caracteres
    const phoneRegex = /^[0-9+\-()\s]{8,20}$/;
    if (!phoneRegex.test(trimmedPhone)) {
      return res.status(400).json({ error: 'Ingresá un teléfono válido (solo números, espacios, + y -)' });
    }
    if (!deliveryType || !['retiro', 'envio'].includes(deliveryType)) {
      return res.status(400).json({ error: 'Debe seleccionar un tipo de entrega válido (retiro o envio).' });
    }
    if (deliveryType === 'envio' && (!deliveryAddress || !deliveryAddress.trim())) {
      return res.status(400).json({ error: 'La dirección de entrega es obligatoria para envíos a domicilio.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El carrito no contiene productos.' });
    }

    // Verificar productos y calcular total real desde la base de datos
    const productIds = items
      .map(i => i && i.productId !== undefined && i.productId !== null ? Number(i.productId) : null)
      .filter(id => id !== null && !isNaN(id));

    if (productIds.length === 0) {
      return res.status(400).json({ error: 'No se enviaron productos válidos.' });
    }

    const placeholders = productIds.map(() => '?').join(',');
    const dbProducts = db.prepare(`SELECT * FROM products WHERE id IN (${placeholders})`).all(...productIds);
    const productMap = new Map(dbProducts.map(p => [p.id, p]));

    const processedItems = [];
    let calculatedSubtotal = 0;

    for (const item of items) {
      if (!item || item.productId === undefined || item.productId === null) {
        return res.status(400).json({ error: 'Ítem de producto no especificado.' });
      }

      const prodId = Number(item.productId);
      const prod = productMap.get(prodId);

      // Rechazar (400) productos inexistentes o inactivos
      if (!prod || prod.is_active === 0) {
        return res.status(400).json({ error: 'El producto seleccionado no está disponible o está inactivo.' });
      }

      // Rechazar (400) productos marcados sin stock
      if (prod.is_out_of_stock === 1) {
        return res.status(400).json({ error: `El producto "${prod.name}" no tiene stock disponible.` });
      }

      // Cantidad válida: número finito > 0 y máximo 10000. Si no es número, rechazar en vez de convertirla en 1
      const rawQty = item.quantity;
      if (rawQty === null || rawQty === undefined || typeof rawQty === 'boolean') {
        return res.status(400).json({ error: `Cantidad inválida para "${prod.name}". Debe ser un número mayor a 0 y hasta 10.000.` });
      }
      if (typeof rawQty !== 'number' && (typeof rawQty !== 'string' || rawQty.trim() === '')) {
        return res.status(400).json({ error: `Cantidad inválida para "${prod.name}". Debe ser un número mayor a 0 y hasta 10.000.` });
      }

      const qty = Number(rawQty);
      if (!Number.isFinite(qty) || isNaN(qty) || qty <= 0 || qty > 10000) {
        return res.status(400).json({ error: `Cantidad inválida para "${prod.name}". Debe ser un número mayor a 0 y hasta 10.000.` });
      }

      // Rechazar cantidades mayores al stock disponible
      if (prod.stock !== null && prod.stock !== undefined && qty > prod.stock) {
        return res.status(400).json({
          error: `La cantidad solicitada para "${prod.name}" (${qty} ${prod.unit}) supera el stock disponible (${prod.stock} ${prod.unit}).`
        });
      }

      const subtotal = prod.price * qty;
      calculatedSubtotal += subtotal;

      processedItems.push({
        productId: prod.id,
        productName: prod.name,
        unit: prod.unit,
        unitPrice: prod.price,
        quantity: qty,
        subtotal
      });
    }

    if (processedItems.length === 0) {
      return res.status(400).json({ error: 'Ninguno de los productos seleccionados es válido.' });
    }

    // Validación de Pedido Mínimo para envíos
    if (deliveryType === 'envio' && calculatedSubtotal < config.MIN_ORDER_AMOUNT) {
      return res.status(400).json({
        error: `El pedido mínimo para envíos es de ${formatMoney(config.MIN_ORDER_AMOUNT)}. Tu subtotal actual es de ${formatMoney(calculatedSubtotal)}.`
      });
    }

    // Costo y nombre de zona de envío
    let shippingCost = 0;
    let shippingZoneName = null;
    if (deliveryType === 'envio') {
      const zone = config.SHIPPING_ZONES.find(z => z.id === shippingZoneId);
      if (zone) {
        shippingCost = zone.price;
        shippingZoneName = zone.name;
      } else {
        shippingZoneName = 'A coordinar';
      }
    }

    const calculatedTotal = calculatedSubtotal + shippingCost;

    // Guardar pedido en transacción
    const orderNumber = getNextOrderNumber();
    let orderId;

    const saveOrderTransaction = db.transaction(() => {
      const insertOrder = db.prepare(`
        INSERT INTO orders (order_number, customer_name, customer_phone, delivery_type, delivery_address, shipping_zone, shipping_cost, subtotal, notes, total, status)
        VALUES (@order_number, @customer_name, @customer_phone, @delivery_type, @delivery_address, @shipping_zone, @shipping_cost, @subtotal, @notes, @total, 'Nuevo')
      `);

      const result = insertOrder.run({
        order_number: orderNumber,
        customer_name: customerName.trim(),
        customer_phone: trimmedPhone,
        delivery_type: deliveryType,
        delivery_address: deliveryType === 'envio' ? deliveryAddress.trim() : null,
        shipping_zone: shippingZoneName,
        shipping_cost: shippingCost,
        subtotal: calculatedSubtotal,
        notes: notes ? notes.trim() : null,
        total: calculatedTotal
      });

      orderId = result.lastInsertRowid;

      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, unit, unit_price, quantity, subtotal)
        VALUES (@order_id, @product_id, @product_name, @unit, @unit_price, @quantity, @subtotal)
      `);

      for (const item of processedItems) {
        insertItem.run({
          order_id: orderId,
          product_id: item.productId,
          product_name: item.productName,
          unit: item.unit,
          unit_price: item.unitPrice,
          quantity: item.quantity,
          subtotal: item.subtotal
        });
      }
    });

    saveOrderTransaction();

    // Notificar en vivo a los paneles admin conectados (SSE)
    broadcastOrderEvent('new_order', {
      orderNumber,
      orderId,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      total: calculatedTotal,
      totalFormatted: formatMoney(calculatedTotal),
      deliveryType,
      created_at: new Date().toISOString()
    });

    // Armar mensaje para WhatsApp ordenado y profesional
    const fecha = new Date().toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    let entregaTexto = deliveryType === 'envio' 
      ? `🚚 *Entrega:* Envío a domicilio\n📍 *Dirección:* ${deliveryAddress.trim()}`
      : `🏬 *Entrega:* Retiro en local`;

    if (deliveryType === 'envio' && shippingZoneName) {
      entregaTexto += `\n🗺️ *Zona de flete:* ${shippingZoneName} (${shippingCost > 0 ? formatMoney(shippingCost) : 'A coordinar'})`;
    }

    let waMessage = `*¡Hola! Quiero hacer el Pedido #${orderNumber}*\n`;
    waMessage += `*${config.STORE_NAME}*\n`;
    waMessage += `🗓️ ${fecha}\n\n`;
    waMessage += `👤 *Cliente:* ${customerName.trim()}\n`;
    waMessage += `📱 *Teléfono:* ${customerPhone.trim()}\n`;
    waMessage += `${entregaTexto}\n`;

    if (notes && notes.trim()) {
      waMessage += `📝 *Observaciones:* ${notes.trim()}\n`;
    }

    waMessage += `\n📦 *DETALLE DEL PEDIDO:*\n`;
    for (const item of processedItems) {
      waMessage += `• ${item.quantity} x ${item.productName} (${item.unit})\n`;
      waMessage += `  ${formatMoney(item.unitPrice)} c/u = *${formatMoney(item.subtotal)}*\n`;
    }

    if (deliveryType === 'envio' && shippingCost > 0) {
      waMessage += `\nSubtotal materiales: ${formatMoney(calculatedSubtotal)}\n`;
      waMessage += `Costo de envío: ${formatMoney(shippingCost)}\n`;
    }

    waMessage += `\n💰 *TOTAL A PAGAR: ${formatMoney(calculatedTotal)}*\n\n`;
    waMessage += `_Pedido registrado en sistema (#${orderNumber})._`;

    const cleanPhone = String(config.WHATSAPP_PHONE).replace(/[^0-9]/g, '');
    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMessage)}`;

    res.json({
      success: true,
      orderNumber,
      orderId,
      subtotal: calculatedSubtotal,
      shippingCost,
      total: calculatedTotal,
      totalFormatted: formatMoney(calculatedTotal),
      whatsappUrl,
      messagePreview: waMessage
    });
  } catch (err) {
    console.error('Error al procesar pedido:', err);
    res.status(500).json({ error: 'Error al registrar el pedido.' });
  }
});

// ---------------------------------------------------------------------
// HISTORIAL DE CLIENTE Y REPETIR PEDIDO
// ---------------------------------------------------------------------

// Obtener pedidos anteriores de un cliente por teléfono (Privacidad protegida)
app.get('/api/customer/orders', (req, res) => {
  try {
    const rawPhone = (req.query.phone || '').trim().replace(/[^0-9]/g, '');
    if (!rawPhone || rawPhone.length < 8) {
      return res.status(400).json({ error: 'Ingresá tu número de teléfono completo (mínimo 8 dígitos).' });
    }

    // Buscar pedidos que coincidan con el teléfono, máximo 3 resultados
    const orders = db.prepare(`
      SELECT id, order_number, total, status, created_at
      FROM orders
      WHERE replace(replace(replace(replace(replace(customer_phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') LIKE ?
      ORDER BY id DESC
      LIMIT 3
    `).all(`%${rawPhone}%`);

    const orderItemsStmt = db.prepare(`
      SELECT oi.product_name, oi.unit, oi.quantity, oi.unit_price, oi.subtotal, p.image_url
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?
      ORDER BY oi.id ASC
    `);

    const enrichedOrders = orders.map(order => {
      const items = orderItemsStmt.all(order.id);
      return {
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        created_at: order.created_at,
        total: order.total,
        totalFormatted: formatMoney(order.total),
        items: items.map(item => ({
          product_name: item.product_name,
          unit: item.unit,
          quantity: item.quantity,
          unitPriceFormatted: formatMoney(item.unit_price),
          subtotalFormatted: formatMoney(item.subtotal),
          image_url: item.image_url
        }))
      };
    });

    res.json({ orders: enrichedOrders });
  } catch (err) {
    console.error('Error al buscar historial de pedidos:', err);
    res.status(500).json({ error: 'Error al consultar pedidos anteriores.' });
  }
});

// Cargar un pedido anterior al carrito (con validación estricta de teléfono y sin filtrar datos personales)
app.post('/api/customer/repeat-order', (req, res) => {
  try {
    const { orderId, phone } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'ID de pedido no especificado.' });
    }

    const cleanInputPhone = String(phone || '').replace(/[^0-9]/g, '');
    if (!cleanInputPhone || cleanInputPhone.length < 8) {
      return res.status(400).json({ error: 'Se requiere el número de teléfono completo del pedido (mínimo 8 dígitos).' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: 'Pedido anterior no encontrado.' });

    const cleanOrderPhone = String(order.customer_phone || '').replace(/[^0-9]/g, '');
    if (!cleanOrderPhone.includes(cleanInputPhone) && !cleanInputPhone.includes(cleanOrderPhone)) {
      return res.status(403).json({ error: 'El número de teléfono no coincide con el del pedido.' });
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    const alerts = [];
    const availableItems = [];

    for (const item of items) {
      const currentProd = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);

      if (!currentProd || currentProd.is_active === 0) {
        alerts.push({
          type: 'unavailable',
          message: `El producto "${item.product_name}" ya no se encuentra en el catálogo.`
        });
        continue;
      }

      if (currentProd.is_out_of_stock === 1) {
        alerts.push({
          type: 'out_of_stock',
          message: `El producto "${currentProd.name}" se encuentra sin stock actualmente.`
        });
        continue;
      }

      if (currentProd.price !== item.unit_price) {
        alerts.push({
          type: 'price_changed',
          message: `"${currentProd.name}" actualizó su precio de ${formatMoney(item.unit_price)} a ${formatMoney(currentProd.price)}.`
        });
      }

      availableItems.push({
        productId: currentProd.id,
        product: currentProd,
        quantity: item.quantity
      });
    }

    res.json({
      success: true,
      items: availableItems,
      alerts
    });
  } catch (err) {
    console.error('Error al preparar repetición de pedido:', err);
    res.status(500).json({ error: 'Error al cargar pedido anterior.' });
  }
});

// Generador de Código QR en SVG para imprimir
app.get('/api/qr.svg', async (req, res) => {
  try {
    const host = req.get('host');
    const protocol = req.protocol;
    const catalogUrl = `${protocol}://${host}/`;

    const svg = await QRCode.toString(catalogUrl, {
      type: 'svg',
      color: {
        dark: config.SECONDARY_COLOR || '#0f172a',
        light: '#ffffff'
      },
      margin: 1
    });

    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    console.error('Error generando QR:', err);
    res.status(500).send('Error al generar código QR.');
  }
});

// Página lista para imprimir cartel QR de mostrador
app.get('/qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'qr.html'));
});

// ---------------------------------------------------------------------
// RUTAS DE AUTENTICACIÓN ADMIN
// ---------------------------------------------------------------------

app.post('/api/admin/login', loginRateLimiter, (req, res) => {
  const { password } = req.body;
  if (!password || password !== config.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.add(token);

  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 días
  });

  res.json({ success: true, message: 'Autenticado correctamente' });
});

app.post('/api/admin/logout', (req, res) => {
  const token = req.cookies?.admin_session;
  if (token) adminSessions.delete(token);
  res.clearCookie('admin_session');
  res.json({ success: true });
});

app.get('/api/admin/check-auth', (req, res) => {
  const token = req.cookies?.admin_session;
  const isAuthenticated = Boolean(token && adminSessions.has(token));
  res.json({ authenticated: isAuthenticated });
});

// ---------------------------------------------------------------------
// RUTAS DEL PANEL ADMIN (Protegidas)
// ---------------------------------------------------------------------

// Obtener pedidos con sus productos
app.get('/api/admin/orders', requireAdminAuth, (req, res) => {
  try {
    const { status, dateRange } = req.query;
    let query = `SELECT * FROM orders WHERE 1=1`;
    const params = [];

    if (status && status !== 'Todos') {
      query += ` AND status = ?`;
      params.push(status);
    }

    if (dateRange === 'today') {
      query += ` AND date(created_at, 'localtime') = date('now', 'localtime')`;
    } else if (dateRange === 'week') {
      query += ` AND created_at >= datetime('now', '-7 days', 'localtime')`;
    } else if (dateRange === 'month') {
      query += ` AND created_at >= datetime('now', '-30 days', 'localtime')`;
    }

    query += ` ORDER BY id DESC`;

    const orders = db.prepare(query).all(...params);

    // Obtener ítems para cada pedido
    const orderItemsStmt = db.prepare(`
      SELECT oi.*, p.image_url
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?
      ORDER BY oi.id ASC
    `);

    const enrichedOrders = orders.map(order => {
      const items = orderItemsStmt.all(order.id);
      return {
        ...order,
        totalFormatted: formatMoney(order.total),
        items: items.map(item => ({
          ...item,
          unitPriceFormatted: formatMoney(item.unit_price),
          subtotalFormatted: formatMoney(item.subtotal)
        }))
      };
    });

    res.json({ orders: enrichedOrders });
  } catch (err) {
    console.error('Error al listar pedidos:', err);
    res.status(500).json({ error: 'Error al obtener pedidos.' });
  }
});

// Actualizar estado de un pedido (1 click) con descuento de stock y aviso WhatsApp
app.patch('/api/admin/orders/:id/status', requireAdminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['Nuevo', 'Preparando', 'Listo', 'Entregado', 'Cancelado'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Estado no válido.' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    // Descuento automático de stock al pasar a "Preparando"
    if (status === 'Preparando' && config.AUTO_DEDUCT_STOCK && !order.stock_deducted) {
      const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(id);
      const deductTx = db.transaction(() => {
        for (const item of items) {
          if (item.product_id) {
            db.prepare(`
              UPDATE products 
              SET stock = MAX(0, stock - ?),
                  is_out_of_stock = CASE WHEN (stock - ?) <= 0 THEN 1 ELSE is_out_of_stock END
              WHERE id = ?
            `).run(item.quantity, item.quantity, item.product_id);
          }
        }
        db.prepare('UPDATE orders SET stock_deducted = 1 WHERE id = ?').run(id);
      });
      deductTx();
    }

    // Reposición de stock si un pedido con stock descontado pasa a "Cancelado" o vuelve a "Nuevo"
    if ((status === 'Cancelado' || status === 'Nuevo') && order.stock_deducted === 1) {
      const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(id);
      const replenishTx = db.transaction(() => {
        for (const item of items) {
          if (item.product_id) {
            db.prepare(`
              UPDATE products 
              SET stock = stock + ?,
                  is_out_of_stock = CASE WHEN (stock + ?) > 0 THEN 0 ELSE is_out_of_stock END
              WHERE id = ?
            `).run(item.quantity, item.quantity, item.product_id);
          }
        }
        db.prepare('UPDATE orders SET stock_deducted = 0 WHERE id = ?').run(id);
      });
      replenishTx();
    }

    // Actualizar estado
    db.prepare(`UPDATE orders SET status = ? WHERE id = ?`).run(status, id);

    // Mensaje pre-armado para avisar al cliente por WhatsApp
    let notificationMessage = '';
    const clientName = order.customer_name;
    const orderNum = order.order_number;

    if (status === 'Preparando') {
      notificationMessage = `¡Hola ${clientName}! 👋 Te avisamos de ${config.STORE_NAME} que tu Pedido #${orderNum} ya se está preparando en el depósito 🧱.`;
    } else if (status === 'Listo') {
      notificationMessage = order.delivery_type === 'retiro'
        ? `¡Hola ${clientName}! 🎉 Tu Pedido #${orderNum} de ${config.STORE_NAME} ya está LISTO para retirar en nuestro local 🏬. ¡Te esperamos!`
        : `¡Hola ${clientName}! 🚚 Tu Pedido #${orderNum} de ${config.STORE_NAME} ya está preparado y listo para salir en el próximo reparto a tu obra.`;
    } else if (status === 'Entregado') {
      notificationMessage = `¡Hola ${clientName}! Confirmamos la entrega de tu Pedido #${orderNum}. ¡Muchas gracias por tu compra en ${config.STORE_NAME}! Esperamos que todo haya quedado de diez. 🤝`;
    }

    // Notificar por SSE a otros paneles
    broadcastOrderEvent('status_change', {
      orderId: id,
      status,
      orderNumber: order.order_number
    });

    res.json({
      success: true,
      status,
      notificationMessage,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      orderNumber: order.order_number
    });
  } catch (err) {
    console.error('Error al actualizar estado:', err);
    res.status(500).json({ error: 'Error al cambiar estado del pedido.' });
  }
});

// Eventos en vivo vía SSE para el panel de administración
app.get('/api/admin/events', requireAdminAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseAdminClients.add(res);
  res.write(`event: connected\ndata: {"status":"connected"}\n\n`);

  req.on('close', () => {
    sseAdminClients.delete(res);
  });
});

// Polling fallback para verificar nuevos pedidos
app.get('/api/admin/orders/check-updates', requireAdminAuth, (req, res) => {
  try {
    const lastId = parseInt(req.query.lastId || '0', 10);
    const newOrders = db.prepare('SELECT id, order_number, customer_name, total, status FROM orders WHERE id > ? ORDER BY id DESC').all(lastId);
    res.json({ hasNew: newOrders.length > 0, count: newOrders.length, newOrders });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar actualizaciones.' });
  }
});

// Resumen del día y métricas comerciales
app.get('/api/admin/metrics', requireAdminAuth, (req, res) => {
  try {
    const { range } = req.query; // 'today', 'week', 'month'
    let dateCondition = '';

    if (range === 'today') {
      dateCondition = `AND date(created_at, 'localtime') = date('now', 'localtime')`;
    } else if (range === 'week') {
      dateCondition = `AND created_at >= datetime('now', '-7 days', 'localtime')`;
    } else if (range === 'month') {
      dateCondition = `AND created_at >= datetime('now', '-30 days', 'localtime')`;
    }

    const summary = db.prepare(`
      SELECT 
        COUNT(*) as totalOrders,
        COALESCE(SUM(CASE WHEN status != 'Cancelado' THEN total ELSE 0 END), 0) as totalRevenue,
        COALESCE(AVG(CASE WHEN status != 'Cancelado' THEN total ELSE NULL END), 0) as avgTicket
      FROM orders
      WHERE 1=1 ${dateCondition}
    `).get();

    const statusRows = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM orders
      WHERE 1=1 ${dateCondition}
      GROUP BY status
    `).all();

    const statusCounts = { Nuevo: 0, Preparando: 0, Listo: 0, Entregado: 0, Cancelado: 0 };
    for (const row of statusRows) {
      statusCounts[row.status] = row.count;
    }

    // Top 5 productos más pedidos en el rango
    const topProducts = db.prepare(`
      SELECT 
        oi.product_name,
        oi.unit,
        SUM(oi.quantity) as totalQty,
        SUM(oi.subtotal) as totalSubtotal
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status != 'Cancelado' ${dateCondition.replace(/created_at/g, 'o.created_at')}
      GROUP BY oi.product_name, oi.unit
      ORDER BY totalQty DESC
      LIMIT 5
    `).all();

    res.json({
      totalOrders: summary.totalOrders || 0,
      totalRevenue: summary.totalRevenue || 0,
      totalRevenueFormatted: formatMoney(summary.totalRevenue || 0),
      avgTicket: Math.round(summary.avgTicket || 0),
      avgTicketFormatted: formatMoney(summary.avgTicket || 0),
      statusCounts,
      topProducts: topProducts.map(p => ({
        ...p,
        totalSubtotalFormatted: formatMoney(p.totalSubtotal)
      }))
    });
  } catch (err) {
    console.error('Error al calcular métricas:', err);
    res.status(500).json({ error: 'Error al obtener métricas del negocio.' });
  }
});

// Exportar pedidos a archivo CSV (con mitigación de inyección de fórmulas CSV)
app.get('/api/admin/orders/export-csv', requireAdminAuth, (req, res) => {
  try {
    const { status, dateRange } = req.query;
    let query = `SELECT * FROM orders WHERE 1=1`;
    const params = [];

    if (status && status !== 'Todos') {
      query += ` AND status = ?`;
      params.push(status);
    }
    if (dateRange === 'today') {
      query += ` AND date(created_at, 'localtime') = date('now', 'localtime')`;
    } else if (dateRange === 'week') {
      query += ` AND created_at >= datetime('now', '-7 days', 'localtime')`;
    } else if (dateRange === 'month') {
      query += ` AND created_at >= datetime('now', '-30 days', 'localtime')`;
    }
    query += ` ORDER BY id DESC`;

    const orders = db.prepare(query).all(...params);
    const orderItemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');

    function sanitizeCsvCell(val) {
      if (val === null || val === undefined) return '';
      let str = String(val);
      // Prevenir inyección de fórmulas en Excel/Google Sheets
      if (/^[=\+\-@]/.test(str)) {
        str = "'" + str;
      }
      return str.replace(/"/g, '""');
    }

    let csv = '\uFEFF'; // BOM para Excel UTF-8
    csv += 'Numero_Pedido;Fecha;Cliente;Telefono;Entrega;Direccion;Zona_Flete;Costo_Flete;Subtotal;Total;Estado;Observaciones;Materiales\n';

    for (const ord of orders) {
      const items = orderItemsStmt.all(ord.id);
      const itemsStr = items.map(i => `${i.quantity} ${i.unit} ${i.product_name}`).join(' | ');

      const row = [
        `"#${sanitizeCsvCell(ord.order_number)}"`,
        `"${sanitizeCsvCell(ord.created_at)}"`,
        `"${sanitizeCsvCell(ord.customer_name)}"`,
        `"${sanitizeCsvCell(ord.customer_phone)}"`,
        `"${ord.delivery_type === 'envio' ? 'Envío' : 'Retiro'}"`,
        `"${sanitizeCsvCell(ord.delivery_address)}"`,
        `"${sanitizeCsvCell(ord.shipping_zone)}"`,
        ord.shipping_cost || 0,
        ord.subtotal || ord.total,
        ord.total,
        `"${sanitizeCsvCell(ord.status)}"`,
        `"${sanitizeCsvCell(ord.notes)}"`,
        `"${sanitizeCsvCell(itemsStr)}"`
      ];

      csv += row.join(';') + '\n';
    }

    const filename = `pedidos_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('Error al exportar CSV:', err);
    res.status(500).send('Error exportando pedidos a CSV');
  }
});

// Subida de fotos de productos
app.post('/api/admin/upload-image', requireAdminAuth, (req, res, next) => {
  imageUpload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Error al procesar la imagen.' });
    }
    next();
  });
}, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se envió ningún archivo de imagen.' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, imageUrl });
  } catch (err) {
    console.error('Error al subir imagen:', err);
    res.status(400).json({ error: err.message || 'Error al procesar la imagen.' });
  }
});

// Ver Remito de un pedido para imprimir
app.get('/admin/orders/:id/remito', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'remito.html'));
});

// Listar todos los productos para administración (incluyendo inactivos y stock bajo)
app.get('/api/admin/products', requireAdminAuth, (req, res) => {
  try {
    const products = db.prepare(`SELECT * FROM products ORDER BY category ASC, name ASC`).all();
    const enriched = products.map(p => ({
      ...p,
      priceFormatted: formatMoney(p.price),
      isLowStock: p.stock <= (p.min_stock !== undefined ? p.min_stock : 10)
    }));
    res.json({ products: enriched });
  } catch (err) {
    console.error('Error al listar productos admin:', err);
    res.status(500).json({ error: 'Error al obtener productos.' });
  }
});

// Crear producto
app.post('/api/admin/products', requireAdminAuth, (req, res) => {
  try {
    const { name, category, unit, price, stock, min_stock, is_active, is_out_of_stock, image_url, is_featured } = req.body;

    if (!name || !category || price === undefined || price === null || price === '') {
      return res.status(400).json({ error: 'Nombre, categoría y precio son obligatorios.' });
    }

    const numPrice = Number(price);
    const numStock = stock !== undefined && stock !== '' ? Number(stock) : 0;

    if (!Number.isFinite(numPrice) || numPrice <= 0) {
      return res.status(400).json({ error: 'El precio debe ser un número mayor a cero.' });
    }
    if (!Number.isFinite(numStock) || numStock < 0) {
      return res.status(400).json({ error: 'El stock no puede ser un valor negativo.' });
    }

    const stmt = db.prepare(`
      INSERT INTO products (name, category, unit, price, stock, min_stock, is_active, is_out_of_stock, image_url, is_featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name.trim(),
      category.trim(),
      (unit || 'unidad').trim(),
      numPrice,
      numStock,
      min_stock !== undefined ? Number(min_stock) : 10,
      is_active !== undefined ? Number(is_active) : 1,
      is_out_of_stock !== undefined ? Number(is_out_of_stock) : 0,
      image_url ? image_url.trim() : null,
      is_featured !== undefined ? Number(is_featured) : 0
    );

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('Error al crear producto:', err);
    res.status(500).json({ error: 'Error al crear producto.' });
  }
});

// Modificar producto
app.put('/api/admin/products/:id', requireAdminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, unit, price, stock, min_stock, is_active, is_out_of_stock, image_url, is_featured } = req.body;

    const numPrice = Number(price);
    const numStock = stock !== undefined && stock !== '' ? Number(stock) : 0;

    if (!Number.isFinite(numPrice) || numPrice <= 0) {
      return res.status(400).json({ error: 'El precio debe ser un número mayor a cero.' });
    }
    if (!Number.isFinite(numStock) || numStock < 0) {
      return res.status(400).json({ error: 'El stock no puede ser un valor negativo.' });
    }

    const stmt = db.prepare(`
      UPDATE products
      SET name = ?, category = ?, unit = ?, price = ?, stock = ?, min_stock = ?, is_active = ?, is_out_of_stock = ?, image_url = ?, is_featured = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      name.trim(),
      category.trim(),
      unit.trim(),
      numPrice,
      numStock,
      min_stock !== undefined ? Number(min_stock) : 10,
      Number(is_active),
      Number(is_out_of_stock),
      image_url ? image_url.trim() : null,
      is_featured !== undefined ? Number(is_featured) : 0,
      id
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error al actualizar producto:', err);
    res.status(500).json({ error: 'Error al actualizar producto.' });
  }
});

// Eliminar producto
app.delete('/api/admin/products/:id', requireAdminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const result = db.prepare(`DELETE FROM products WHERE id = ?`).run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error al eliminar producto:', err);
    res.status(500).json({ error: 'Error al eliminar producto.' });
  }
});

// Helper para parsear CSV (soporta comas o punto y coma de Excel en español)
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  // Detectar delimitador (coma o punto y coma)
  const firstLine = lines[0];
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  // Normalizar encabezados
  const headers = firstLine.split(delimiter).map(h => 
    h.trim().toLowerCase().replace(/"/g, '').normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  );

  const nameIdx = headers.findIndex(h => h.includes('nombre') || h.includes('producto') || h.includes('name'));
  const catIdx = headers.findIndex(h => h.includes('categoria') || h.includes('category') || h.includes('rubro'));
  const unitIdx = headers.findIndex(h => h.includes('unidad') || h.includes('unit') || h.includes('medida'));
  const priceIdx = headers.findIndex(h => h.includes('precio') || h.includes('price') || h.includes('valor'));
  const stockIdx = headers.findIndex(h => h.includes('stock') || h.includes('cantidad'));

  if (nameIdx === -1 || priceIdx === -1) {
    throw new Error('El CSV debe incluir al menos las columnas "nombre" y "precio".');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split respetando comillas simples
    const parts = line.split(delimiter).map(p => p.trim().replace(/^"|"$/g, ''));
    const name = parts[nameIdx];
    if (!name) continue;

    const category = catIdx !== -1 && parts[catIdx] ? parts[catIdx] : 'General';
    const unit = unitIdx !== -1 && parts[unitIdx] ? parts[unitIdx] : 'unidad';
    
    // Limpieza de precio (soporta $ 12.345 o 12345.00)
    let rawPrice = priceIdx !== -1 ? parts[priceIdx] : '0';
    rawPrice = rawPrice.replace(/[^0-9.,]/g, '');
    if (rawPrice.includes(',') && rawPrice.includes('.')) {
      rawPrice = rawPrice.replace(/\./g, '').replace(',', '.');
    } else if (rawPrice.includes(',')) {
      rawPrice = rawPrice.replace(',', '.');
    }
    const price = parseFloat(rawPrice) || 0;

    let stock = 100;
    if (stockIdx !== -1 && parts[stockIdx]) {
      stock = parseInt(parts[stockIdx].replace(/[^0-9-]/g, ''), 10);
      if (isNaN(stock)) stock = 0;
    }

    // Rechazar precio menor o igual a cero o stock negativo
    if (price <= 0 || stock < 0) continue;

    rows.push({
      name,
      category,
      unit,
      price,
      stock,
      is_out_of_stock: stock <= 0 ? 1 : 0
    });
  }

  return rows;
}

// Importar productos desde CSV
app.post('/api/admin/products/import-csv', requireAdminAuth, upload.single('file'), (req, res) => {
  try {
    let csvContent = '';
    if (req.file) {
      csvContent = req.file.buffer.toString('utf-8');
    } else if (req.body.csvText) {
      csvContent = req.body.csvText;
    } else {
      return res.status(400).json({ error: 'No se envió ningún archivo CSV ni texto.' });
    }

    const rows = parseCSV(csvContent);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'El archivo CSV no contiene filas de datos válidas.' });
    }

    const insertOrUpdate = db.prepare(`
      INSERT INTO products (name, category, unit, price, stock, is_active, is_out_of_stock)
      VALUES (@name, @category, @unit, @price, @stock, 1, @is_out_of_stock)
    `);

    const importTx = db.transaction((products) => {
      let count = 0;
      for (const prod of products) {
        insertOrUpdate.run(prod);
        count++;
      }
      return count;
    });

    const insertedCount = importTx(rows);

    res.json({
      success: true,
      message: `Se importaron ${insertedCount} productos con éxito.`,
      count: insertedCount
    });
  } catch (err) {
    console.error('Error al importar CSV:', err);
    res.status(400).json({ error: err.message || 'Error al procesar el archivo CSV.' });
  }
});

// Servir la página del panel de administración
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Manejo de rutas no encontradas -> redirigir al catálogo
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
const serverInstance = app.listen(config.PORT, () => {
  console.log(`====================================================`);
  console.log(`[SERVER]  ${config.STORE_NAME}`);
  console.log(`[CATALOG] Catálogo público:   http://localhost:${config.PORT}/`);
  console.log(`[ADMIN]   Panel de Admin:      http://localhost:${config.PORT}/admin`);
  console.log(`[AUTH]    Panel protegido con contraseña`);
  console.log(`[WA]      WhatsApp Destino:   +${config.WHATSAPP_PHONE}`);
  console.log(`====================================================`);
});

module.exports = { app, server: serverInstance };
